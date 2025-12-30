/**
 * My Day Dashboard Module
 * Role-Based Workflow View
 */

var _myDayDashboard = function () {
    return {
        init: function () {
            this.loadMyDay();
            this.setupAutoRefresh();
        },

        loadMyDay: async function () {
            try {
                if (typeof workflowViews === 'undefined') {
                    console.error('workflowViews not available');
                    return;
                }

                const data = await workflowViews.getMyDayData();
                if (data) {
                    workflowViews.renderMyDay(data, 'my-day-container');
                } else {
                    document.getElementById('my-day-container').innerHTML = `
                        <div class="alert alert-warning">
                            Unable to load your personalized dashboard. Please try again later.
                        </div>
                    `;
                }
            } catch (error) {
                console.error('Error loading My Day:', error);
                document.getElementById('my-day-container').innerHTML = `
                    <div class="alert alert-danger">
                        Error loading dashboard: ${error.message}
                    </div>
                `;
            }
        },

        setupAutoRefresh: function () {
            // Refresh every 5 minutes
            setInterval(() => {
                this.loadMyDay();
            }, 300000);
        }
    };
}();

const myDayDashboard = _myDayDashboard;

function initializeMyDay() {
    if (typeof myDayDashboard !== 'undefined') {
        myDayDashboard.init();
    }
}

