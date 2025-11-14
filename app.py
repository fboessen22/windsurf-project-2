from flask import Flask, jsonify, render_template, request
import pyodbc
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Database configuration
DB_SERVER = os.getenv('DB_SERVER', 'localhost')
DB_NAME = os.getenv('DB_DATABASE', 'msdb')
DB_USERNAME = os.getenv('DB_USERNAME', '')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')

# Application configuration
DEFAULT_CATEGORY = os.getenv('DEFAULT_CATEGORY', 'Quicksilver')

def get_db_connection():
    """Create and return a database connection with support for multiple authentication methods"""
    auth_method = os.getenv('AUTH_METHOD', 'sql').lower()
    
    # Azure AD / SSO Authentication
    if auth_method == 'azuread' or auth_method == 'sso':
        conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={DB_SERVER};DATABASE={DB_NAME};Authentication=ActiveDirectoryInteractive;'
    # Azure AD Integrated (uses current Windows user's Azure AD credentials)
    elif auth_method == 'azuread_integrated':
        conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={DB_SERVER};DATABASE={DB_NAME};Authentication=ActiveDirectoryIntegrated;'
    # Azure AD with username/password
    elif auth_method == 'azuread_password' and DB_USERNAME and DB_PASSWORD:
        conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={DB_SERVER};DATABASE={DB_NAME};Authentication=ActiveDirectoryPassword;UID={DB_USERNAME};PWD={DB_PASSWORD}'
    # SQL Authentication
    elif DB_USERNAME and DB_PASSWORD:
        conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={DB_SERVER};DATABASE={DB_NAME};UID={DB_USERNAME};PWD={DB_PASSWORD}'
    # Windows Authentication
    else:
        conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={DB_SERVER};DATABASE={DB_NAME};Trusted_Connection=yes;'
    
    return pyodbc.connect(conn_str)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/config')
def get_config():
    """Return application configuration"""
    return jsonify({
        'default_category': DEFAULT_CATEGORY
    })

@app.route('/api/test-connection')
def test_connection():
    """Test database connection and return configuration details"""
    try:
        config_info = {
            'server': DB_SERVER,
            'database': DB_NAME,
            'auth_method': os.getenv('AUTH_METHOD', 'sql').lower(),
            'status': 'attempting connection...'
        }
        
        # Try to connect
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT @@VERSION")
        version = cursor.fetchone()[0]
        conn.close()
        
        config_info['status'] = 'connected'
        config_info['sql_version'] = version[:100]  # First 100 chars
        
        return jsonify(config_info)
        
    except Exception as e:
        import traceback
        return jsonify({
            'status': 'failed',
            'error': str(e),
            'type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'server': DB_SERVER,
            'database': DB_NAME,
            'auth_method': os.getenv('AUTH_METHOD', 'sql').lower()
        }), 500

@app.route('/api/categories')
def get_categories():
    """Get all job categories"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = """
        SELECT DISTINCT c.name as category_name
        FROM msdb.dbo.syscategories c
        INNER JOIN msdb.dbo.sysjobs j ON c.category_id = j.category_id
        WHERE c.category_class = 1
        ORDER BY c.name
        """
        
        cursor.execute(query)
        categories = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        return jsonify(categories)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/jobs/stats')
def get_jobs_stats():
    """Get statistics about job executions"""
    try:
        from flask import request
        days = request.args.get('days', '0', type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get stats for the specified time period
        query = """
        SELECT 
            COUNT(*) as total_executions,
            SUM(CASE WHEN h.run_status = 0 THEN 1 ELSE 0 END) as failed_count,
            SUM(CASE WHEN h.run_status = 1 THEN 1 ELSE 0 END) as succeeded_count,
            SUM(CASE WHEN h.run_status = 4 THEN 1 ELSE 0 END) as running_count,
            AVG(CASE WHEN h.run_status IN (0,1) THEN h.run_duration ELSE NULL END) as avg_duration
        FROM msdb.dbo.sysjobhistory h
        WHERE h.step_id = 0
        AND h.run_date >= CONVERT(VARCHAR(8), DATEADD(day, -?, GETDATE()), 112)
        """
        
        cursor.execute(query, days)
        row = cursor.fetchone()
        
        total = row[0] or 0
        succeeded = row[2] or 0
        
        # Calculate success rate with proper rounding (show 99.9% instead of 100% when there are failures)
        if total > 0:
            success_rate = (succeeded / total) * 100
            # Use floor for rates >= 99.95% to avoid showing 100% when there are failures
            if success_rate >= 99.95 and row[1] > 0:  # If there are failures, don't round up to 100
                success_rate = round(success_rate, 2)  # Show 2 decimals for high accuracy
            else:
                success_rate = round(success_rate, 1)
        else:
            success_rate = 0.0
        
        stats = {
            'total_executions': total,
            'failed_count': row[1] or 0,
            'succeeded_count': succeeded,
            'running_count': row[3] or 0,
            'avg_duration': row[4] or 0,
            'success_rate': success_rate
        }
        
        # Format average duration
        if stats['avg_duration']:
            duration = str(int(stats['avg_duration'])).zfill(6)
            hours = int(duration[0:2])
            minutes = int(duration[2:4])
            seconds = int(duration[4:6])
            stats['avg_duration_formatted'] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        else:
            stats['avg_duration_formatted'] = '00:00:00'
        
        conn.close()
        return jsonify(stats)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/jobs')
def get_jobs():
    try:
        from flask import request
        
        # Get days parameter (default to today only)
        days = request.args.get('days', '0', type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Query to get job executions with average duration for comparison
        query = """
        SELECT 
            j.name as job_name,
            j.enabled,
            c.name as category_name,
            h.run_status,
            h.run_date,
            h.run_time,
            h.run_duration,
            h.message,
            h.instance_id,
            j.job_id,
            (SELECT AVG(CAST(h2.run_duration AS BIGINT))
             FROM msdb.dbo.sysjobhistory h2
             WHERE h2.job_id = j.job_id 
             AND h2.step_id = 0
             AND h2.run_status IN (0,1)
             AND h2.run_date >= CONVERT(VARCHAR(8), DATEADD(day, -30, GETDATE()), 112)
            ) as avg_duration
        FROM msdb.dbo.sysjobs j
        INNER JOIN msdb.dbo.syscategories c ON j.category_id = c.category_id
        INNER JOIN msdb.dbo.sysjobhistory h ON j.job_id = h.job_id
        WHERE h.step_id = 0  -- Only job outcomes, not individual steps
        AND h.run_date >= CONVERT(VARCHAR(8), DATEADD(day, -?, GETDATE()), 112)
        ORDER BY h.run_date DESC, h.run_time DESC
        """
        
        cursor.execute(query, days)
        columns = [column[0] for column in cursor.description]
        jobs = []
        
        for row in cursor.fetchall():
            job = dict(zip(columns, row))
            # Format run date and time if available
            # SQL Server Agent stores times in local server time (already CST)
            if job['run_date'] and job['run_time']:
                from datetime import datetime
                run_date = str(job['run_date'])
                run_time = str(job['run_time']).zfill(6)
                # Parse time (already in CST from SQL Server)
                local_time = datetime.strptime(f"{run_date} {run_time}", "%Y%m%d %H%M%S")
                job['last_run'] = local_time.strftime("%Y-%m-%d %I:%M:%S %p CST")
            else:
                job['last_run'] = 'Never'
            
            # Format duration and compare to average
            if job['run_duration']:
                duration = str(job['run_duration']).zfill(6)
                hours = int(duration[0:2])
                minutes = int(duration[2:4])
                seconds = int(duration[4:6])
                job['duration_formatted'] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                
                # Compare to average duration (30-day average)
                if job['avg_duration'] and job['avg_duration'] > 0:
                    current_duration = job['run_duration']
                    avg = job['avg_duration']
                    diff_percent = ((current_duration - avg) / avg) * 100
                    
                    if diff_percent > 20:  # More than 20% slower
                        job['duration_trend'] = 'slower'
                        job['duration_diff'] = f"+{abs(int(diff_percent))}%"
                    elif diff_percent < -20:  # More than 20% faster
                        job['duration_trend'] = 'faster'
                        job['duration_diff'] = f"-{abs(int(diff_percent))}%"
                    else:
                        job['duration_trend'] = 'normal'
                        job['duration_diff'] = None
                else:
                    job['duration_trend'] = 'normal'
                    job['duration_diff'] = None
            else:
                job['duration_formatted'] = 'N/A'
                job['duration_trend'] = 'normal'
                job['duration_diff'] = None
                
            # Add status text
            status_codes = {
                0: 'Failed',
                1: 'Succeeded',
                2: 'Retry',
                3: 'Canceled',
                4: 'In Progress'
            }
            job['status_text'] = status_codes.get(job.get('run_status'), 'Unknown')
            
            jobs.append(job)
            
        return jsonify(jobs)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
        
    finally:
        if 'conn' in locals():
            conn.close()

@app.route('/api/ssis/executions-by-package')
def get_ssis_executions_by_package():
    """Get recent SSIS executions for a specific package path"""
    try:
        from flask import request
        package_path = request.args.get('package_path', '')
        failed_only = request.args.get('failed_only', 'false').lower() == 'true'
        
        if not package_path:
            return jsonify({'error': 'Package path required'}), 400
        
        # Parse the package path (format: folder\project\package.dtsx)
        parts = package_path.split('\\')
        if len(parts) < 3:
            return jsonify({'error': 'Invalid package path format'}), 400
        
        folder_name = parts[0]
        project_name = parts[1]
        package_name = parts[2]
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Add status filter if failed_only is requested
        status_filter = "AND e.status = 4" if failed_only else ""
        
        query = f"""
        SELECT TOP 50
            e.execution_id,
            FORMAT(CAST(e.start_time AS DATETIME), 'yyyy-MM-dd HH:mm:ss') as start_time,
            FORMAT(CAST(e.end_time AS DATETIME), 'yyyy-MM-dd HH:mm:ss') as end_time,
            e.status,
            CASE e.status
                WHEN 1 THEN 'Created'
                WHEN 2 THEN 'Running'
                WHEN 3 THEN 'Canceled'
                WHEN 4 THEN 'Failed'
                WHEN 5 THEN 'Pending'
                WHEN 6 THEN 'Ended Unexpectedly'
                WHEN 7 THEN 'Succeeded'
                WHEN 8 THEN 'Stopping'
                WHEN 9 THEN 'Completed'
                ELSE 'Unknown'
            END as status_text
        FROM SSISDB.catalog.executions e
        WHERE e.folder_name = ?
        AND e.project_name = ?
        AND e.package_name = ?
        AND e.start_time >= DATEADD(DAY, -30, GETDATE())
        {status_filter}
        ORDER BY e.start_time DESC
        """
        
        cursor.execute(query, (folder_name, project_name, package_name))
        executions = []
        
        for row in cursor.fetchall():
            executions.append({
                'execution_id': row[0],
                'start_time': str(row[1]),
                'end_time': str(row[2]) if row[2] else None,
                'status': row[3],
                'status_text': row[4]
            })
        
        conn.close()
        return jsonify(executions)
        
    except Exception as e:
        import traceback
        return jsonify({
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500

@app.route('/api/ssis/execution/<int:execution_id>')
def get_ssis_execution_details(execution_id):
    """Get detailed SSIS execution information including error messages"""
    try:
        from flask import request
        show_all = request.args.get('show_all', 'false').lower() == 'true'
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get execution overview
        query_overview = """
        SELECT 
            e.execution_id,
            e.folder_name,
            e.project_name,
            e.package_name,
            e.status,
            FORMAT(CAST(e.start_time AS DATETIME), 'yyyy-MM-dd HH:mm:ss') as start_time,
            FORMAT(CAST(e.end_time AS DATETIME), 'yyyy-MM-dd HH:mm:ss') as end_time,
            CASE e.status
                WHEN 1 THEN 'Created'
                WHEN 2 THEN 'Running'
                WHEN 3 THEN 'Canceled'
                WHEN 4 THEN 'Failed'
                WHEN 5 THEN 'Pending'
                WHEN 6 THEN 'Ended Unexpectedly'
                WHEN 7 THEN 'Succeeded'
                WHEN 8 THEN 'Stopping'
                WHEN 9 THEN 'Completed'
                ELSE 'Unknown'
            END as status_text
        FROM SSISDB.catalog.executions e
        WHERE e.execution_id = ?
        """
        
        cursor.execute(query_overview, execution_id)
        overview = cursor.fetchone()
        
        if not overview:
            return jsonify({'error': 'Execution not found'}), 404
        
        overview_dict = dict(zip([column[0] for column in cursor.description], overview))
        
        # Get messages - filter based on show_all parameter
        message_type_filter = "" if show_all else "AND om.message_type IN (120, 130, 110)  -- Errors, TaskFailed, Warnings"
        
        query_messages = f"""
        SELECT 
            om.operation_message_id,
            FORMAT(CAST(om.message_time AS DATETIME), 'yyyy-MM-dd HH:mm:ss') as message_time,
            om.message_type,
            CASE om.message_type
                WHEN -1 THEN 'Unknown'
                WHEN 120 THEN 'Error'
                WHEN 110 THEN 'Warning'
                WHEN 70 THEN 'Information'
                WHEN 10 THEN 'Pre-validate'
                WHEN 20 THEN 'Post-validate'
                WHEN 30 THEN 'Pre-execute'
                WHEN 40 THEN 'Post-execute'
                WHEN 60 THEN 'Progress'
                WHEN 50 THEN 'StatusChange'
                WHEN 100 THEN 'QueryCancel'
                WHEN 130 THEN 'TaskFailed'
                ELSE CAST(om.message_type AS VARCHAR)
            END as message_type_text,
            om.message
        FROM SSISDB.catalog.operation_messages om
        WHERE om.operation_id = ?
        {message_type_filter}
        ORDER BY om.message_time DESC  -- Show newest messages first (descending)
        """
        
        cursor.execute(query_messages, execution_id)
        messages = []
        for row in cursor.fetchall():
            msg = dict(zip([column[0] for column in cursor.description], row))
            messages.append(msg)
        
        conn.close()
        
        return jsonify({
            'overview': overview_dict,
            'messages': messages
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500

@app.route('/api/job/ssis-executions/<job_name>')
def get_job_ssis_executions(job_name):
    """Get SSIS execution IDs for a specific job from job history"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Extract execution IDs from job step messages
        query = """
        SELECT DISTINCT
            h.instance_id,
            h.run_date,
            h.run_time,
            h.step_name,
            h.message,
            h.run_status
        FROM msdb.dbo.sysjobs j
        JOIN msdb.dbo.sysjobhistory h ON j.job_id = h.job_id
        WHERE j.name = ?
        AND h.step_id > 0
        AND h.message LIKE '%execution_id%'
        ORDER BY h.run_date DESC, h.run_time DESC
        """
        
        cursor.execute(query, job_name)
        results = []
        
        for row in cursor.fetchall():
            record = dict(zip([column[0] for column in cursor.description], row))
            
            # Try to extract execution_id from message
            import re
            message = record.get('message', '')
            match = re.search(r'execution_id[:\s]+(\d+)', message, re.IGNORECASE)
            if match:
                record['execution_id'] = int(match.group(1))
            
            results.append(record)
        
        conn.close()
        return jsonify(results)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/job/steps/<int:instance_id>')
def get_job_steps(instance_id):
    """Get steps for a specific job execution instance"""
    try:
        from datetime import datetime, timedelta
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # First get the job execution details
        query_main = """
        SELECT 
            j.job_id,
            j.name as job_name,
            h.run_date,
            h.run_time,
            h.run_duration,
            h.run_status
        FROM msdb.dbo.sysjobhistory h
        JOIN msdb.dbo.sysjobs j ON h.job_id = j.job_id
        WHERE h.instance_id = ? AND h.step_id = 0
        """
        
        cursor.execute(query_main, instance_id)
        main_row = cursor.fetchone()
        
        if not main_row:
            return jsonify({'error': 'Execution not found'}), 404
        
        job_id, job_name, run_date, run_time, run_duration, overall_status = main_row
        
        # Get all steps from history
        query_history_steps = """
        SELECT 
            h.step_id,
            h.step_name,
            h.run_status,
            h.run_duration,
            h.message,
            h.sql_message_id,
            h.sql_severity
        FROM msdb.dbo.sysjobhistory h
        WHERE h.instance_id = ?
        ORDER BY h.step_id ASC
        """
        
        cursor.execute(query_history_steps, instance_id)
        history_steps = {row[0]: row for row in cursor.fetchall()}
        
        # Get all defined steps for this job (to show steps that didn't run)
        query_defined_steps = """
        SELECT 
            s.step_id,
            s.step_name,
            s.command,
            s.subsystem
        FROM msdb.dbo.sysjobsteps s
        WHERE s.job_id = ?
        ORDER BY s.step_id ASC
        """
        
        cursor.execute(query_defined_steps, job_id)
        defined_steps = cursor.fetchall()
        
        steps = []
        
        # Get the job outcome to determine which steps ran
        job_outcome_message = ''
        last_step_run = None
        job_failed = False
        
        if 0 in history_steps:
            outcome_row = history_steps[0]
            job_outcome_message = outcome_row[4] or ''
            job_failed = outcome_row[2] == 0  # run_status = 0 means failed
            
            # Extract which step was the last to run from message like "The last step to run was step 4"
            import re
            step_match = re.search(r'last step to run was step (\d+)', job_outcome_message, re.IGNORECASE)
            if step_match:
                last_step_run = int(step_match.group(1))
        
        # Add all defined steps (skip step_id = 0 which is the job outcome)
        for defined_row in defined_steps:
            step_id = defined_row[0]
            
            if step_id in history_steps:
                # Step was executed and has its own history record
                row = history_steps[step_id]
                step = {
                    'step_id': row[0],
                    'step_name': row[1],
                    'run_status': row[2],
                    'run_duration': row[3],
                    'message': row[4],
                    'sql_message_id': row[5],
                    'sql_severity': row[6],
                    'command': defined_row[2],
                    'subsystem': defined_row[3],
                    'executed': True
                }
            elif last_step_run is not None and step_id <= last_step_run:
                # This step ran (it's at or before the last step that ran)
                # but doesn't have its own history record
                # Mark as succeeded if before the failed step, or failed if it's the last step
                if step_id == last_step_run and job_failed:
                    # This is the step that failed
                    outcome_row = history_steps[0]
                    step = {
                        'step_id': defined_row[0],
                        'step_name': defined_row[1],
                        'run_status': outcome_row[2],  # Failed status from job outcome
                        'run_duration': outcome_row[3],
                        'message': outcome_row[4],
                        'sql_message_id': outcome_row[5],
                        'sql_severity': outcome_row[6],
                        'command': defined_row[2],
                        'subsystem': defined_row[3],
                        'executed': True
                    }
                else:
                    # This step ran successfully (before the failed step)
                    step = {
                        'step_id': defined_row[0],
                        'step_name': defined_row[1],
                        'run_status': 1,  # Succeeded
                        'run_duration': None,
                        'message': 'Step completed successfully (no detailed history available)',
                        'sql_message_id': None,
                        'sql_severity': None,
                        'command': defined_row[2],
                        'subsystem': defined_row[3],
                        'executed': True
                    }
                    step['duration_formatted'] = 'N/A'
                    step['status_text'] = 'Succeeded'
            else:
                # Step was not executed (job failed before reaching it)
                step = {
                    'step_id': defined_row[0],
                    'step_name': defined_row[1],
                    'run_status': None,
                    'run_duration': None,
                    'message': 'Step not executed (job failed before reaching this step)',
                    'sql_message_id': None,
                    'sql_severity': None,
                    'command': defined_row[2],
                    'subsystem': defined_row[3],
                    'executed': False
                }
                step['duration_formatted'] = 'N/A'
                step['status_text'] = 'Not Run'
            
            # Format duration for executed steps
            if step.get('executed') and step['run_duration']:
                duration = str(step['run_duration']).zfill(6)
                hours = int(duration[0:2])
                minutes = int(duration[2:4])
                seconds = int(duration[4:6])
                step['duration_formatted'] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
            elif step.get('executed'):
                step['duration_formatted'] = 'N/A'
            
            # Add status text for executed steps
            if step.get('executed') and step['run_status'] is not None:
                status_codes = {
                    0: 'Failed',
                    1: 'Succeeded',
                    2: 'Retry',
                    3: 'Canceled',
                    4: 'In Progress'
                }
                step['status_text'] = status_codes.get(step['run_status'], 'Unknown')
            
            # Check if this is an SSIS step and extract package path
            if step.get('command'):
                import re
                # Try multiple patterns for SSIS package path
                # Pattern 1: /ISSERVER "\SSISDB\folder\project\package.dtsx" (quoted path with spaces)
                path_match = re.search(r'/ISSERVER\s+"\\SSISDB\\([^"]+)"', step['command'], re.IGNORECASE)
                if not path_match:
                    # Pattern 2: /ISSERVER \SSISDB\folder\project\package.dtsx (unquoted, look for .dtsx)
                    path_match = re.search(r'/ISSERVER\s+\\SSISDB\\([^\s]+\.dtsx)', step['command'], re.IGNORECASE)
                if not path_match:
                    # Pattern 3: Just look for SSISDB path anywhere with quotes
                    path_match = re.search(r'"\\SSISDB\\([^"]+)"', step['command'], re.IGNORECASE)
                if not path_match:
                    # Pattern 4: SSISDB path ending with .dtsx (no quotes, no spaces)
                    path_match = re.search(r'\\SSISDB\\([^\s]+\.dtsx)', step['command'], re.IGNORECASE)
                
                if path_match:
                    step['ssis_package_path'] = path_match.group(1)
                    step['subsystem'] = 'SSIS'  # Mark as SSIS step
                
                # Also check for execution_id in message
                if step.get('message') and 'execution_id' in step['message'].lower():
                    exec_match = re.search(r'execution_id[:\s]+(\d+)', step['message'], re.IGNORECASE)
                    if exec_match:
                        step['ssis_execution_id'] = int(exec_match.group(1))
            
            steps.append(step)
        
        # For SSIS steps without execution_id, try to find it based on timing
        # Calculate job start and end times
        # NOTE: SQL Server Agent stores times in local server time (CST)
        # SSISDB stores times in UTC with DATETIMEOFFSET
        # We need to convert the job times to UTC for comparison
        job_start_time_local = None
        job_end_time_local = None
        
        if run_date and run_time:
            from datetime import datetime, timedelta
            run_date_str = str(run_date)
            run_time_str = str(run_time).zfill(6)
            job_start_time_local = datetime.strptime(f"{run_date_str} {run_time_str}", "%Y%m%d %H%M%S")
            
            # Calculate end time from duration
            if run_duration:
                duration_str = str(run_duration).zfill(6)
                hours = int(duration_str[0:2])
                minutes = int(duration_str[2:4])
                seconds = int(duration_str[4:6])
                duration_delta = timedelta(hours=hours, minutes=minutes, seconds=seconds)
                job_end_time_local = job_start_time_local + duration_delta + timedelta(minutes=2)  # Add 2 minute buffer
        
        # Query to find execution_id for SSIS packages based on timing
        for step in steps:
            if step.get('ssis_package_path') and not step.get('ssis_execution_id') and job_start_time_local and job_end_time_local:
                # Parse package path
                parts = step['ssis_package_path'].split('\\')
                if len(parts) >= 3:
                    folder_name = parts[0]
                    project_name = parts[1]
                    package_name = parts[2]
                    
                    # Match status: if step failed (run_status=0), look for failed SSIS execution (status=4)
                    status_filter = ""
                    if step.get('run_status') == 0:
                        status_filter = "AND e.status = 4"  # Failed
                    elif step.get('run_status') == 1:
                        status_filter = "AND e.status = 7"  # Succeeded
                    
                    # Convert times to string format for SQL Server
                    job_start_str = job_start_time_local.strftime("%Y-%m-%d %H:%M:%S")
                    job_end_str = job_end_time_local.strftime("%Y-%m-%d %H:%M:%S")
                    
                    # Use AT TIME ZONE to convert local time to UTC for comparison with SSISDB times
                    # SSISDB.catalog.executions.start_time is stored as DATETIMEOFFSET in UTC
                    query_exec = f"""
                    SELECT TOP 1 e.execution_id, e.status, FORMAT(CAST(e.start_time AS DATETIME), 'yyyy-MM-dd HH:mm:ss') as start_time
                    FROM SSISDB.catalog.executions e
                    WHERE e.folder_name = ?
                    AND e.project_name = ?
                    AND e.package_name = ?
                    AND e.start_time >= CAST(? AS DATETIME) AT TIME ZONE 'Central Standard Time' AT TIME ZONE 'UTC'
                    AND e.start_time <= CAST(? AS DATETIME) AT TIME ZONE 'Central Standard Time' AT TIME ZONE 'UTC'
                    {status_filter}
                    ORDER BY e.start_time ASC
                    """
                    
                    cursor.execute(query_exec, (folder_name, project_name, package_name, job_start_str, job_end_str))
                    exec_row = cursor.fetchone()
                    if exec_row:
                        step['ssis_execution_id'] = exec_row[0]
                        step['ssis_execution_status'] = exec_row[1]
                        step['ssis_start_time'] = str(exec_row[2]) if exec_row[2] else None
        
        conn.close()
        
        # Debug: Include raw command in response for troubleshooting
        for step in steps:
            if step.get('command'):
                step['command_preview'] = step['command'][:200] if len(step.get('command', '')) > 200 else step.get('command')
        
        return jsonify({
            'job_name': job_name,
            'instance_id': instance_id,
            'steps': steps
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500

@app.route('/api/job/history/<job_name>')
def get_job_history(job_name):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = """
        SELECT 
            h.instance_id,
            h.run_date,
            h.run_time,
            h.run_duration,
            h.run_status,
            h.message,
            h.step_id,
            h.step_name,
            h.sql_message_id,
            h.sql_severity
        FROM msdb.dbo.sysjobs j
        JOIN msdb.dbo.sysjobhistory h ON j.job_id = h.job_id
        WHERE j.name = ?
        ORDER BY h.run_date DESC, h.run_time DESC, h.step_id ASC
        """
        
        cursor.execute(query, job_name)
        columns = [column[0] for column in cursor.description]
        history = []
        
        for row in cursor.fetchall():
            record = dict(zip(columns, row))
            
            # Format run date and time
            run_date = str(record['run_date'])
            run_time = str(record['run_time']).zfill(6)
            record['run_timestamp'] = f"{run_date[:4]}-{run_date[4:6]}-{run_date[6:]} {run_time[:2]}:{run_time[2:4]}:{run_time[4:6]}"
            
            # Format duration
            if record['run_duration']:
                duration = str(record['run_duration']).zfill(6)
                hours = int(duration[0:2])
                minutes = int(duration[2:4])
                seconds = int(duration[4:6])
                record['duration_formatted'] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
            else:
                record['duration_formatted'] = 'N/A'
            
            # Add status text
            status_codes = {
                0: 'Failed',
                1: 'Succeeded',
                2: 'Retry',
                3: 'Canceled',
                4: 'In Progress'
            }
            record['status_text'] = status_codes.get(record.get('run_status'), 'Unknown')
            
            history.append(record)
            
        return jsonify(history)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
        
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == '__main__':
    app.run(debug=True)
