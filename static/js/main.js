let allJobs = [];
let selectedCategory = '';
let currentPage = 1;
let itemsPerPage = 25;
let selectedDays = 0;
let autoRefreshInterval = null;
let refreshCountdown = 60;
let soundEnabled = true;
let previousFailedCount = 0;
let darkMode = localStorage.getItem('darkMode') === 'true';

$(document).ready(function() {
    // Initialize dark mode
    if (darkMode) {
        $('body').addClass('dark-mode');
        $('#darkModeToggle i').removeClass('bi-moon-fill').addClass('bi-sun-fill');
    }
    
    // Initialize sound toggle
    updateSoundIcon();
    
    // Load config first, then load data
    loadConfig();
    
    // Dark mode toggle
    $('#darkModeToggle').on('click', function() {
        darkMode = !darkMode;
        $('body').toggleClass('dark-mode');
        localStorage.setItem('darkMode', darkMode);
        $(this).find('i').toggleClass('bi-moon-fill bi-sun-fill');
    });
    
    // Sound toggle
    $('#soundToggle').on('click', function() {
        soundEnabled = !soundEnabled;
        localStorage.setItem('soundEnabled', soundEnabled);
        updateSoundIcon();
    });
    
    // Auto-refresh toggle
    $('#autoRefresh').on('change', function() {
        if ($(this).is(':checked')) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });
    
    // Refresh button
    $('#refreshBtn').on('click', function() {
        loadJobs();
        loadStats();
    });
    
    // Category filter change
    $('#categoryFilter').on('change', function() {
        selectedCategory = $(this).val();
        currentPage = 1;
        filterAndDisplayJobs();
    });
    
    // Days filter change
    $('#daysFilter').on('change', function() {
        selectedDays = parseInt($(this).val());
        currentPage = 1;
        loadJobs();
        loadStats();
    });
    
    // Search input
    $('#searchInput').on('keyup', function() {
        currentPage = 1;
        filterAndDisplayJobs();
    });
    
    // Show only failed toggle
    $('#showOnlyFailed').on('change', function() {
        currentPage = 1;
        filterAndDisplayJobs();
    });
});

function loadConfig() {
    $.get('/api/config')
        .done(function(config) {
            // Set default category from config
            selectedCategory = config.default_category || '';
            
            // Now load the rest
            loadCategories();
            loadJobs();
            loadStats();
        })
        .fail(function() {
            // If config fails, just use empty default
            selectedCategory = '';
            loadCategories();
            loadJobs();
            loadStats();
        });
}

function loadCategories() {
    $.get('/api/categories')
        .done(function(categories) {
            const select = $('#categoryFilter');
            select.empty();
            select.append('<option value="">All Categories</option>');
            
            categories.forEach(function(category) {
                const option = $('<option></option>')
                    .val(category)
                    .text(category);
                
                // Set default selected category
                if (category === selectedCategory) {
                    option.prop('selected', true);
                }
                
                select.append(option);
            });
            
            // Trigger initial filter
            filterAndDisplayJobs();
        })
        .fail(function() {
            console.error('Failed to load categories');
        });
}

function updateCategoryCounts() {
    if (!allJobs || allJobs.length === 0) return;
    
    // Count failed jobs per category
    const categoryCounts = {};
    allJobs.forEach(function(job) {
        const category = job.category_name || 'Uncategorized';
        if (!categoryCounts[category]) {
            categoryCounts[category] = { total: 0, failed: 0 };
        }
        categoryCounts[category].total++;
        if (job.run_status === 0) {
            categoryCounts[category].failed++;
        }
    });
    
    // Update dropdown options with counts
    $('#categoryFilter option').each(function() {
        const category = $(this).val();
        if (category === '') {
            const totalFailed = allJobs.filter(j => j.run_status === 0).length;
            $(this).text(`All Categories (${totalFailed} failed)`);
        } else if (categoryCounts[category]) {
            const counts = categoryCounts[category];
            $(this).text(`${category} (${counts.failed} failed / ${counts.total} total)`);
        }
    });
}

function loadJobs() {
    const days = parseInt($('#daysFilter').val()) || 0;
    
    $('#loading').show();
    $('#jobsContainer').empty();
    
    $.get('/api/jobs', { days: days })
        .done(function(data) {
            allJobs = data;
            updateCategoryCounts(data);
            filterAndDisplayJobs();
            updateRefreshTime();
        })
        .fail(function(xhr) {
            $('#jobsContainer').html('<div class="alert alert-danger">Failed to load jobs: ' + (xhr.responseJSON?.error || 'Unknown error') + '</div>');
        })
        .always(function() {
            $('#loading').hide();
        });
}

function updateRefreshTime() {
    const now = new Date();
    const timeString = now.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: undefined  // Remove timezone offset
    });
    $('#lastRefreshTime').text(timeString);
}

function filterAndDisplayJobs() {
    const searchTerm = $('#searchInput').val().toLowerCase();
    const showOnlyFailed = $('#showOnlyFailed').is(':checked');
    
    let filteredJobs = allJobs;
    let statsJobs = allJobs; // For stats, ignore the "show only failed" filter
    
    // Filter by category
    if (selectedCategory) {
        filteredJobs = filteredJobs.filter(job => 
            job.category_name === selectedCategory
        );
        statsJobs = statsJobs.filter(job => 
            job.category_name === selectedCategory
        );
    }
    
    // Filter by search term
    if (searchTerm) {
        filteredJobs = filteredJobs.filter(job => 
            job.job_name.toLowerCase().includes(searchTerm)
        );
        statsJobs = statsJobs.filter(job => 
            job.job_name.toLowerCase().includes(searchTerm)
        );
    }
    
    // Filter by failed status (only for display, not for stats)
    if (showOnlyFailed) {
        filteredJobs = filteredJobs.filter(job => job.run_status === 0);
    }
    
    // Paginate
    const totalPages = Math.ceil(filteredJobs.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedJobs = filteredJobs.slice(startIndex, endIndex);
    
    displayJobs(paginatedJobs);
    renderPagination(totalPages, filteredJobs.length);
    
    // Update stats based on filtered jobs (excluding "show only failed" filter)
    updateStatsFromFilteredJobs(statsJobs);
}

function renderPagination(totalPages, totalItems) {
    const pagination = $('#pagination');
    pagination.empty();
    
    if (totalPages <= 1) {
        $('#paginationNav').hide();
        return;
    }
    
    $('#paginationNav').show();
    
    // Previous button
    pagination.append(`
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a>
        </li>
    `);
    
    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
        pagination.append(`<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`);
        if (startPage > 2) {
            pagination.append(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        pagination.append(`
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" data-page="${i}">${i}</a>
            </li>
        `);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pagination.append(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
        }
        pagination.append(`<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`);
    }
    
    // Next button
    pagination.append(`
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage + 1}">Next</a>
        </li>
    `);
    
    // Add showing info
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);
    $('#jobsContainer').prepend(`
        <div class="alert alert-info mb-3">
            Showing ${startItem}-${endItem} of ${totalItems} executions
        </div>
    `);
    
    // Attach click handlers
    $('.page-link').on('click', function(e) {
        e.preventDefault();
        const page = parseInt($(this).data('page'));
        if (page && page !== currentPage && page >= 1 && page <= totalPages) {
            currentPage = page;
            filterAndDisplayJobs();
            $('html, body').animate({ scrollTop: 0 }, 'fast');
        }
    });
}

function displayJobs(jobs) {
    const container = $('#jobsContainer');
    container.empty();
    
    if (jobs.length === 0) {
        container.html('<div class="alert alert-info">No jobs found matching the current filters.</div>');
        return;
    }
    
    jobs.forEach(function(job) {
        const statusClass = getStatusClass(job.run_status);
        const statusText = job.status_text || 'Unknown';
        const instanceId = job.instance_id || 'N/A';
        
        const jobCard = `
            <div class="card job-card mb-3 fade-in">
                <div class="card-body">
                    <div class="row align-items-center">
                        <div class="col-md-4">
                            <h6 class="mb-0">${escapeHtml(job.job_name)}</h6>
                            <small class="text-muted">${escapeHtml(job.category_name || 'N/A')}</small>
                        </div>
                        <div class="col-md-2">
                            <span class="badge ${statusClass}">${statusText}</span>
                        </div>
                        <div class="col-md-3">
                            <small><i class="bi bi-clock"></i> ${escapeHtml(job.last_run)}</small>
                            ${job.duration_formatted ? `<br><small class="text-muted">Duration: ${escapeHtml(job.duration_formatted)}</small>` : ''}
                        </div>
                        <div class="col-md-3 text-end">
                            <button class="btn btn-sm btn-outline-primary load-history" 
                                    data-job-name="${escapeHtml(job.job_name)}"
                                    data-instance-id="${instanceId}">
                                <i class="bi bi-list-ul"></i> View Steps
                            </button>
                        </div>
                    </div>
                    ${job.message && job.run_status === 0 ? `
                        <div class="row mt-2">
                            <div class="col-12">
                                <div class="alert alert-danger py-1 px-2 mb-0">
                                    <small><strong>Error:</strong> ${escapeHtml(job.message.substring(0, 200))}${job.message.length > 200 ? '...' : ''}</small>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                    <div class="history-container mt-2" style="display: none;"></div>
                </div>
            </div>
        `;
        
        container.append(jobCard);
    });
    
    // Attach click handlers
    $('.load-history').on('click', function() {
        const instanceId = $(this).data('instance-id');
        const historyContainer = $(this).closest('.card-body').find('.history-container');
        
        if (historyContainer.is(':visible')) {
            historyContainer.slideUp();
            $(this).html('<i class="bi bi-list-ul"></i> View Steps');
        } else {
            loadJobSteps(instanceId, historyContainer, $(this));
            $(this).html('<i class="bi bi-chevron-up"></i> Hide Steps');
        }
    });
}

function loadJobSteps(instanceId, container, button) {
    container.html('<div class="text-center"><div class="spinner-border spinner-border-sm"></div> Loading steps...</div>');
    container.slideDown();
    button.html('<i class="bi bi-chevron-up"></i> Hide Steps');
    
    $.get(`/api/job/steps/${instanceId}`)
        .done(function(data) {
            if (!data.steps || data.steps.length === 0) {
                container.html('<div class="alert alert-info">No steps found for this execution</div>');
                return;
            }
            
            // Debug: Log steps to console
            console.log('Job steps data:', data.steps);
            
            let html = `
                <div class="p-3 border rounded steps-container">
                    <h6>Job Steps for ${escapeHtml(data.job_name)}</h6>
                    <table class="table table-sm table-hover">
                        <thead>
                            <tr>
                                <th>Step</th>
                                <th>Status</th>
                                <th>Duration</th>
                                <th>Message</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            data.steps.forEach(function(step, index) {
                const stepStatusClass = step.executed === false ? 'bg-secondary' : getStatusClass(step.run_status);
                const hasSSIS = (step.ssis_execution_id || step.ssis_package_path) && step.executed !== false;
                const stepLabel = step.step_id === 0 ? '(Job Outcome)' : `Step ${step.step_id}`;
                const stepName = step.step_name || 'N/A';
                const rowClass = step.executed === false ? 'table-secondary' : '';
                const isTSQL = step.subsystem === 'TSQL' && step.command;
                const stepId = `step-${index}`;
                
                // Store step data for later retrieval
                if (!window.stepDataCache) window.stepDataCache = {};
                window.stepDataCache[stepId] = step;
                
                html += `
                    <tr class="${rowClass}">
                        <td>
                            <strong>${escapeHtml(stepName)}</strong>
                            <br><small class="text-muted">${stepLabel}</small>
                            ${step.ssis_package_path ? `<br><small class="text-info"><i class="bi bi-box"></i> ${escapeHtml(step.ssis_package_path)}</small>` : ''}
                            ${isTSQL ? `<br><small class="text-primary"><i class="bi bi-code-square"></i> T-SQL Script</small>` : ''}
                        </td>
                        <td><span class="badge ${stepStatusClass}">${escapeHtml(step.status_text)}</span></td>
                        <td>${escapeHtml(step.duration_formatted || 'N/A')}</td>
                        <td>
                            <div class="text-truncate" style="max-width: 400px;" title="${escapeHtml(step.message || '')}">
                                ${escapeHtml((step.message || 'N/A').substring(0, 150))}${step.message && step.message.length > 150 ? '...' : ''}
                            </div>
                        </td>
                        <td>
                            ${hasSSIS ? `<button class="btn btn-sm btn-outline-info me-1" onclick="loadSSISDetailsForStep(window.stepDataCache['${stepId}'])">
                                <i class="bi bi-file-earmark-text"></i> SSIS Logs
                            </button>` : ''}
                            ${isTSQL ? `<button class="btn btn-sm btn-outline-primary" onclick="showTSQLScript('${stepId}')">
                                <i class="bi bi-code-square"></i> View SQL
                            </button>` : ''}
                        </td>
                    </tr>
                `;
            });
            
            html += '</tbody></table></div>';
            container.html(html);
        })
        .fail(function(xhr) {
            container.html(`<div class="alert alert-danger">Failed to load steps: ${xhr.responseJSON?.error || 'Unknown error'}</div>`);
        });
}

function loadJobHistory(jobName, container, button) {
    container.html('<div class="text-center"><div class="spinner-border spinner-border-sm"></div> Loading history...</div>');
    container.slideDown();
    button.html('<i class="bi bi-chevron-up"></i> Hide History');
    
    $.get(`/api/job/history/${encodeURIComponent(jobName)}`)
        .done(function(history) {
            if (history.length === 0) {
                container.html('<div class="alert alert-info">No history available</div>');
                return;
            }
            
            // Group history by run (step_id 0 is the job outcome)
            const runs = {};
            history.forEach(function(record) {
                const runKey = `${record.run_date}_${record.run_time}`;
                if (!runs[runKey]) {
                    runs[runKey] = {
                        timestamp: record.run_timestamp,
                        outcome: null,
                        steps: []
                    };
                }
                
                if (record.step_id === 0) {
                    runs[runKey].outcome = record;
                } else {
                    runs[runKey].steps.push(record);
                }
            });
            
            let html = '<div class="accordion" id="historyAccordion">';
            let runIndex = 0;
            
            Object.keys(runs).forEach(function(runKey) {
                const run = runs[runKey];
                const outcome = run.outcome;
                const statusClass = outcome ? getStatusClass(outcome.run_status) : 'bg-secondary';
                const statusText = outcome ? outcome.status_text : 'Unknown';
                
                html += `
                    <div class="accordion-item">
                        <h2 class="accordion-header" id="heading${runIndex}">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" 
                                    data-bs-target="#collapse${runIndex}" aria-expanded="false">
                                <span class="badge ${statusClass} me-2">${statusText}</span>
                                <span>${run.timestamp}</span>
                                ${outcome && outcome.duration_formatted ? `<span class="ms-2 text-muted">(${outcome.duration_formatted})</span>` : ''}
                            </button>
                        </h2>
                        <div id="collapse${runIndex}" class="accordion-collapse collapse" 
                             data-bs-parent="#historyAccordion">
                            <div class="accordion-body">
                                <h6>Job Steps:</h6>
                                <table class="table table-sm table-hover">
                                    <thead>
                                        <tr>
                                            <th>Step</th>
                                            <th>Status</th>
                                            <th>Duration</th>
                                            <th>Message</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                `;
                
                run.steps.forEach(function(step) {
                    const stepStatusClass = getStatusClass(step.run_status);
                    const hasSSIS = step.message && step.message.includes('execution_id');
                    
                    html += `
                        <tr>
                            <td><strong>${escapeHtml(step.step_name)}</strong></td>
                            <td><span class="badge ${stepStatusClass}">${escapeHtml(step.status_text)}</span></td>
                            <td>${escapeHtml(step.duration_formatted || 'N/A')}</td>
                            <td>
                                <div class="text-truncate" style="max-width: 400px;" title="${escapeHtml(step.message || '')}">
                                    ${escapeHtml((step.message || 'N/A').substring(0, 100))}${step.message && step.message.length > 100 ? '...' : ''}
                                </div>
                            </td>
                            <td>
                                ${hasSSIS ? `<button class="btn btn-sm btn-outline-info" onclick="loadSSISDetails('${escapeHtml(step.message)}', '${escapeHtml(step.step_name)}')">
                                    <i class="bi bi-file-earmark-text"></i> SSIS Details
                                </button>` : ''}
                            </td>
                        </tr>
                    `;
                });
                
                html += `
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
                runIndex++;
            });
            
            html += '</div>';
            container.html(html);
        })
        .fail(function() {
            container.html('<div class="alert alert-danger">Failed to load history</div>');
        });
}

// Load SSIS execution details for a step
window.loadSSISDetailsForStep = function(step) {
    const executionId = step.ssis_execution_id;
    const packagePath = step.ssis_package_path;
    const stepName = step.step_name;
    const stepFailed = step.run_status === 0;
    
    if (executionId) {
        // We have the execution ID, load it directly
        loadSSISDetails(executionId, stepName);
    } else if (packagePath) {
        // No execution ID, but we have the package path - find recent executions
        // If the step failed, only show failed executions
        loadSSISExecutionsByPackage(packagePath, stepName, stepFailed);
    } else {
        alert('No SSIS execution information available');
    }
};

// Load SSIS executions by package path
function loadSSISExecutionsByPackage(packagePath, stepName, failedOnly = false) {
    // Create modal
    const modalHtml = `
        <div class="modal fade" id="ssisModal" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">SSIS Executions - ${escapeHtml(stepName)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="ssisModalBody">
                        <div class="text-center">
                            <div class="spinner-border"></div>
                            <p>Loading SSIS executions...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    $('#ssisModal').remove();
    $('.modal-backdrop').remove();
    $('body').append(modalHtml);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('ssisModal'));
    modal.show();
    
    // Clean up when modal is hidden
    $('#ssisModal').on('hidden.bs.modal', function () {
        $(this).remove();
        $('.modal-backdrop').remove();
        $('body').removeClass('modal-open');
        $('body').css('padding-right', '');
    });
    
    // Load executions
    const params = { package_path: packagePath };
    if (failedOnly) {
        params.failed_only = 'true';
    }
    
    $.get('/api/ssis/executions-by-package', params)
        .done(function(executions) {
            if (!executions || executions.length === 0) {
                $('#ssisModalBody').html(`
                    <div class="alert alert-warning">
                        <strong>No executions found for this package</strong>
                        <p class="mb-0">The SSIS execution logs may have been purged. SSISDB typically retains logs for 7-30 days depending on server configuration.</p>
                    </div>
                `);
                return;
            }
            
            const filterText = failedOnly ? ' (failed only)' : '';
            let html = `
                <div class="mb-3">
                    <p><strong>Package:</strong> ${escapeHtml(packagePath)}</p>
                    <div class="alert alert-info mb-2">
                        <i class="bi bi-info-circle"></i> 
                        <strong>Note:</strong> Could not find the specific execution for this job run. 
                        Showing recent${filterText} executions from the last 30 days. The execution you're looking for may have been purged from SSISDB.
                    </div>
                    <p class="text-muted">Click on an execution to view detailed logs</p>
                </div>
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th>Execution ID</th>
                            <th>Start Time</th>
                            <th>End Time</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            executions.forEach(function(exec) {
                const statusClass = exec.status === 7 ? 'bg-success' : (exec.status === 4 ? 'bg-danger' : 'bg-secondary');
                html += `
                    <tr>
                        <td>${exec.execution_id}</td>
                        <td>${exec.start_time}</td>
                        <td>${exec.end_time || 'Running'}</td>
                        <td><span class="badge ${statusClass}">${escapeHtml(exec.status_text)}</span></td>
                        <td>
                            <button class="btn btn-sm btn-primary" onclick="loadSSISDetails(${exec.execution_id}, '${escapeHtml(stepName)}')">
                                <i class="bi bi-eye"></i> View Logs
                            </button>
                        </td>
                    </tr>
                `;
            });
            
            html += '</tbody></table>';
            $('#ssisModalBody').html(html);
        })
        .fail(function(xhr) {
            $('#ssisModalBody').html(`
                <div class="alert alert-danger">
                    Failed to load SSIS executions: ${xhr.responseJSON?.error || 'Unknown error'}
                </div>
            `);
        });
}

// Load SSIS execution details
window.loadSSISDetails = function(executionId, stepName) {
    if (!executionId) {
        alert('No execution ID provided');
        return;
    }
    
    // Create modal
    const modalHtml = `
        <div class="modal fade" id="ssisModal" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">SSIS Execution Details - ${escapeHtml(stepName)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="ssisModalBody">
                        <div class="text-center">
                            <div class="spinner-border"></div>
                            <p>Loading SSIS execution details...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    $('#ssisModal').remove();
    $('.modal-backdrop').remove();
    $('body').append(modalHtml);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('ssisModal'));
    modal.show();
    
    // Clean up when modal is hidden
    $('#ssisModal').on('hidden.bs.modal', function () {
        $(this).remove();
        $('.modal-backdrop').remove();
        $('body').removeClass('modal-open');
        $('body').css('padding-right', '');
    });
    
    // Function to load messages with optional show_all parameter
    function loadMessages(showAll = false) {
        const params = showAll ? '?show_all=true' : '';
        
        $.get(`/api/ssis/execution/${executionId}${params}`)
            .done(function(data) {
                let html = `
                    <div class="mb-2">
                        <h6 class="mb-2">Execution Overview</h6>
                        <div class="row g-2 mb-3">
                            <div class="col-md-6">
                                <small class="text-muted">Execution ID:</small> <strong>${data.overview.execution_id}</strong><br>
                                <small class="text-muted">Package:</small> <strong>${escapeHtml(data.overview.package_name)}</strong><br>
                                <small class="text-muted">Project:</small> ${escapeHtml(data.overview.project_name)}<br>
                                <small class="text-muted">Folder:</small> ${escapeHtml(data.overview.folder_name)}
                            </div>
                            <div class="col-md-6">
                                <small class="text-muted">Status:</small> <span class="badge ${data.overview.status === 7 ? 'bg-success' : 'bg-danger'}">${escapeHtml(data.overview.status_text)}</span><br>
                                <small class="text-muted">Start:</small> ${data.overview.start_time}<br>
                                <small class="text-muted">End:</small> ${data.overview.end_time || 'N/A'}
                            </div>
                        </div>
                    </div>
                `;
                
                if (data.messages && data.messages.length > 0) {
                    html += `
                        <div class="mb-3">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <h6 class="mb-0">Messages (${data.messages.length})</h6>
                                <div class="form-check form-switch">
                                    <input class="form-check-input" type="checkbox" id="showAllMessages" ${showAll ? 'checked' : ''}>
                                    <label class="form-check-label" for="showAllMessages">Show all messages</label>
                                </div>
                            </div>
                            <div class="table-responsive" style="max-height: 600px; overflow-y: auto;">
                                <table class="table table-sm table-hover">
                                    <thead class="sticky-top">
                                        <tr>
                                            <th style="width: 80px;">Time</th>
                                            <th style="width: 120px;">Type</th>
                                            <th>Message</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                    `;
                    
                    data.messages.forEach(function(msg) {
                        const isError = msg.message_type === 120 || msg.message_type === 130;
                        const isWarning = msg.message_type === 110;
                        const badgeClass = isError ? 'bg-danger' : (isWarning ? 'bg-warning' : 'bg-info');
                        
                        // Extract just the time from the datetime string (format: "YYYY-MM-DD HH:MM:SS")
                        const timeOnly = msg.message_time ? msg.message_time.split(' ')[1] : '';
                        
                        html += `
                            <tr>
                                <td><small>${escapeHtml(timeOnly)}</small></td>
                                <td><span class="badge ${badgeClass}">${escapeHtml(msg.message_type_text)}</span></td>
                                <td><div style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(msg.message)}</div></td>
                            </tr>
                        `;
                    });
                    
                    html += '</tbody></table></div></div>';
            } else {
                html += '<div class="alert alert-info">No error messages or warnings found</div>';
            }
            
                $('#ssisModalBody').html(html);
                
                // Add event handler for toggle switch
                $('#showAllMessages').on('change', function() {
                    loadMessages($(this).is(':checked'));
                });
            })
            .fail(function(xhr) {
                $('#ssisModalBody').html(`
                    <div class="alert alert-danger">
                        Failed to load SSIS execution details: ${xhr.responseJSON?.error || 'Unknown error'}
                    </div>
                `);
            });
    }
    
    // Initial load with default (errors/warnings only)
    loadMessages(false);
};

function getStatusClass(status) {
    if (status === 1) return 'bg-success';
    if (status === 0) return 'bg-danger';
    if (status === 4) return 'bg-info';
    if (status === 2 || status === 3) return 'bg-warning';
    return 'bg-secondary';
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text ? text.replace(/[&<>"']/g, m => map[m]) : '';
}

// Load stats dashboard
function loadStats() {
    const days = selectedDays;
    $.get('/api/jobs/stats', { days: days })
        .done(function(stats) {
            displayStats(stats);
            
            // Check for new failures and play sound
            if (soundEnabled && previousFailedCount > 0 && stats.failed_count > previousFailedCount) {
                playAlertSound();
            }
            previousFailedCount = stats.failed_count;
        });
}

// Update stats based on filtered jobs
function updateStatsFromFilteredJobs(jobs) {
    const failedCount = jobs.filter(j => j.run_status === 0).length;
    const succeededCount = jobs.filter(j => j.run_status === 1).length;
    const totalCount = jobs.length;
    
    let successRate = 0;
    if (totalCount > 0) {
        successRate = (succeededCount / totalCount) * 100;
        // Show 2 decimals if rate is very high but not 100%
        if (successRate >= 99.95 && failedCount > 0) {
            successRate = successRate.toFixed(2);
        } else {
            successRate = successRate.toFixed(1);
        }
    }
    
    const stats = {
        failed_count: failedCount,
        succeeded_count: succeededCount,
        success_rate: parseFloat(successRate)
    };
    
    displayStats(stats);
}

// Display stats in the dashboard
function displayStats(stats) {
    // Format numbers with commas
    const failedFormatted = stats.failed_count.toLocaleString();
    const succeededFormatted = stats.succeeded_count.toLocaleString();
    
    const html = `
        <div class="col-md-4">
            <div class="card stats-card border-danger">
                <div class="card-body text-center">
                    <div class="stat-value text-danger">${failedFormatted}</div>
                    <div class="stat-label">Failed Jobs</div>
                </div>
            </div>
        </div>
        <div class="col-md-4">
            <div class="card stats-card border-success">
                <div class="card-body text-center">
                    <div class="stat-value text-success">${succeededFormatted}</div>
                    <div class="stat-label">Succeeded Jobs</div>
                </div>
            </div>
        </div>
        <div class="col-md-4">
            <div class="card stats-card border-primary">
                <div class="card-body text-center">
                    <div class="stat-value text-primary">${stats.success_rate}%</div>
                    <div class="stat-label">Success Rate</div>
                </div>
            </div>
        </div>
    `;
    $('#statsContainer').html(html);
}

// Auto-refresh functions
function startAutoRefresh() {
    refreshCountdown = 60;
    updateRefreshCountdown();
    
    autoRefreshInterval = setInterval(function() {
        refreshCountdown--;
        updateRefreshCountdown();
        
        if (refreshCountdown <= 0) {
            loadJobs();
            loadStats();
            refreshCountdown = 60;
        }
    }, 1000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    $('#refreshCountdown').text('');
}

function updateRefreshCountdown() {
    if (refreshCountdown > 0) {
        $('#refreshCountdown').text(`(${refreshCountdown}s)`);
    }
}

// Sound alert
function playAlertSound() {
    // Create a simple beep using Web Audio API
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
}

function updateSoundIcon() {
    const icon = soundEnabled ? 'bi-volume-up-fill' : 'bi-volume-mute-fill';
    $('#soundToggle i').removeClass('bi-volume-up-fill bi-volume-mute-fill').addClass(icon);
}

// Get duration trend icon
function getDurationTrendIcon(job) {
    if (!job.duration_trend || job.duration_trend === 'normal') {
        return '';
    }
    
    if (job.duration_trend === 'slower') {
        return `<span class="text-warning" title="Slower than average by ${job.duration_diff}"><i class="bi bi-arrow-up-circle-fill"></i> ${job.duration_diff}</span>`;
    } else if (job.duration_trend === 'faster') {
        return `<span class="text-success" title="Faster than average by ${job.duration_diff}"><i class="bi bi-arrow-down-circle-fill"></i> ${job.duration_diff}</span>`;
    }
    
    return '';
}

// Show T-SQL script in modal
function showTSQLScript(stepId) {
    const step = window.stepDataCache[stepId];
    if (!step) {
        alert('Step data not found');
        return;
    }
    
    const modalHtml = `
        <div class="modal fade" id="tsqlModal" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">T-SQL Script - ${escapeHtml(step.step_name)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-2">
                            <strong>Step:</strong> ${step.step_id} - ${escapeHtml(step.step_name)}<br>
                            <strong>Subsystem:</strong> ${escapeHtml(step.subsystem)}
                        </div>
                        <div class="bg-dark text-light p-3 rounded" style="max-height: 600px; overflow-y: auto;">
                            <pre class="mb-0" style="color: #e0e0e0; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(step.command)}</pre>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" id="copySqlBtn">
                            <i class="bi bi-clipboard"></i> Copy to Clipboard
                        </button>
                        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    $('#tsqlModal').remove();
    $('.modal-backdrop').remove();
    $('body').append(modalHtml);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('tsqlModal'));
    modal.show();
    
    // Add copy button handler
    $('#copySqlBtn').on('click', function() {
        copyToClipboard(step.command);
    });
    
    // Clean up when modal is hidden
    $('#tsqlModal').on('hidden.bs.modal', function () {
        $(this).remove();
        $('.modal-backdrop').remove();
        $('body').removeClass('modal-open');
        $('body').css('padding-right', '');
    });
}

// Copy text to clipboard
function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    
    // Show brief success message
    alert('SQL script copied to clipboard!');
}
