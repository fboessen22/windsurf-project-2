# SQL Server Job Monitor

A web-based monitoring tool for SQL Server Agent jobs. Monitor job execution status, view historical data, and analyze job failures and patterns.

## Features

- **Real-time Job Monitoring**: View all SQL Server Agent jobs with their current status
- **Execution History**: See detailed execution history for each job with timestamps and durations
- **Advanced Filtering**: Filter jobs by name, status, and category
- **Error Analysis**: View detailed error messages and job step information
- **Dark Mode UI**: Modern, responsive design with dark theme
- **Multiple Authentication Methods**: Support for Windows, SQL Server, and Azure AD authentication

## Prerequisites

- Python 3.8 or higher
- SQL Server with SQL Server Agent
- ODBC Driver 17 for SQL Server (or newer)
- Access to the `msdb` database on the SQL Server

## Installation

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd de-sql-server-job-monitor
   ```

2. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

3. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```

4. Edit the `.env` file with your configuration (see Configuration section below)

## Configuration

Edit the `.env` file with your settings:

### SQL Server Configuration
```bash
DB_SERVER=your_server_name          # e.g., localhost or datadevjobs.p.db.vu.local
DB_DATABASE=msdb                    # Default: msdb (SQL Server Agent database)
```

### Application Configuration
```bash
DEFAULT_CATEGORY=Quicksilver        # Default job category to display
```

### Authentication Method
Choose one of the following authentication methods:

```bash
AUTH_METHOD=windows                 # Options: sql, windows, azuread, sso, azuread_integrated, azuread_password
```

**Authentication Options:**
- `windows`: Windows Authentication (recommended for domain environments)
- `sql`: SQL Server Authentication (requires DB_USERNAME and DB_PASSWORD)
- `azuread` or `sso`: Azure AD Interactive (browser-based SSO login)
- `azuread_integrated`: Azure AD Integrated (uses current Windows user's Azure AD credentials)
- `azuread_password`: Azure AD with username/password (requires DB_USERNAME and DB_PASSWORD)

**For SQL Server Authentication**, add:
```bash
DB_USERNAME=your_username
DB_PASSWORD=your_password
```

## Running the Application

1. Start the Flask development server:
   ```
   python app.py
   ```
2. Open your web browser and navigate to:
   ```
   http://localhost:5000
   ```

## Usage

### Main Dashboard
- View all SQL Server Agent jobs with their current status (Running, Succeeded, Failed, etc.)
- Jobs are color-coded by status for quick visual identification
- Default view shows jobs from the configured `DEFAULT_CATEGORY`

### Filtering and Search
- **Search by name**: Use the search box to filter jobs by name
- **Filter by status**: Toggle "Show only failed jobs" to focus on problematic jobs
- **Category filter**: Change the category to view different job groups

### Job Details
- Click on a job card to expand and view:
  - Job description and owner
  - Last run date and duration
  - Next scheduled run time
  - Detailed error messages (for failed jobs)

### Execution History
- Click "View History" to see the complete execution history for a specific job
- History includes:
  - Run date and time
  - Duration
  - Status
  - Error messages (if applicable)

## API Endpoints

The application provides the following REST API endpoints:

- `GET /api/config` - Get application configuration
- `GET /api/jobs` - List all SQL Server Agent jobs
- `GET /api/job/history/<job_name>` - Get execution history for a specific job
- `GET /api/job/steps/<instance_id>` - Get job step details for a specific execution

## Security Considerations

- **Never commit the `.env` file** to version control (already excluded in `.gitignore`)
- **Use least privilege**: Use a dedicated SQL Server account with minimal required permissions (read-only access to `msdb`)
- **Windows Authentication**: Recommended for domain environments (no credentials in config files)
- **Production deployment**: 
  - Run behind a reverse proxy (nginx, IIS)
  - Add application-level authentication
  - Use HTTPS/TLS encryption
  - Consider using Azure Key Vault or similar for secrets management

## Troubleshooting

### Connection Issues
- **Symptom**: Cannot connect to SQL Server
- **Solutions**:
  - Verify SQL Server is running and accessible
  - Check firewall rules allow connections on port 1433
  - Verify the server name in `.env` is correct
  - Test connection with SQL Server Management Studio

### Authentication Errors
- **Windows Authentication**: Ensure the Windows user has access to the SQL Server
- **SQL Authentication**: Verify username and password in `.env` are correct
- **Azure AD**: Ensure the user has appropriate Azure AD permissions

### Missing ODBC Driver
- **Symptom**: "Driver not found" error
- **Solution**: Download and install [ODBC Driver 17 for SQL Server](https://docs.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)

### Permission Denied
- **Symptom**: Access denied to `msdb` database
- **Solution**: Grant the SQL Server login `db_datareader` role on the `msdb` database:
  ```sql
  USE msdb;
  GRANT SELECT TO [your_login];
  ```

## Technology Stack

- **Backend**: Flask (Python web framework)
- **Database**: SQL Server (msdb database)
- **Database Driver**: pyodbc with ODBC Driver 17
- **Frontend**: HTML, CSS, JavaScript (jQuery)
- **UI Framework**: Bootstrap 5 with dark theme

## Project Structure

```
de-sql-server-job-monitor/
├── app.py                 # Main Flask application
├── requirements.txt       # Python dependencies
├── .env.example          # Example environment configuration
├── .gitignore            # Git ignore rules
├── README.md             # This file
├── static/               # Static assets (CSS, JS, images)
└── templates/            # HTML templates
    └── index.html        # Main dashboard template
```

## License

This project is open source and available under the [MIT License](LICENSE).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Guidelines
- Follow PEP 8 style guide for Python code
- Test all authentication methods before submitting
- Update documentation for new features
- Ensure `.env.example` is updated with new configuration options
