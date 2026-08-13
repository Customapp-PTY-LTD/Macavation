/**
 * MacReportMetricLine — one metric row (System / Entered / Target / Achieved% / Status) in the
 * report editor. Self-contained: wires its own override/clear buttons, then asks the caller to
 * refetch via ctx.onChanged() rather than trying to patch the row's own numbers locally — the
 * server is the only place that knows the metric's true state after a write (see
 * override_report_metric_value / clear_report_metric_override in
 * migrations/20260817100000_report_instances_and_targets.sql).
 *
 * @typedef {{ reportInstanceId: string, readOnly: boolean, onChanged: function }} MacReportMetricLineCtx
 */
(function (global) {
    'use strict';

    function formatNumber(value, unit) {
        if (value === null || value === undefined || value === '') return null;
        var n = Number(value);
        if (!isFinite(n)) return null;
        var text = (Math.round(n * 100) / 100).toLocaleString();
        return unit ? (text + ' ' + unit) : text;
    }

    function formatTimestamp(ts) {
        if (!ts) return '';
        var s = String(ts);
        if (s.indexOf('T') < 0) return s;
        return s.slice(0, 10).split('-').reverse().join('/') + ' ' + s.slice(11, 16);
    }

    function toast(msg, type) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: type === 'error' ? 'error' : 'success',
                title: type === 'error' ? 'Error' : 'Done',
                text: msg,
                timer: type === 'error' ? undefined : 2000,
                showConfirmButton: type === 'error'
            });
        }
    }

    async function promptOverride(metric, ctx) {
        if (typeof Swal === 'undefined') return;
        var currentValue = metric.entered_value != null ? metric.entered_value : metric.system_value;

        var result = await Swal.fire({
            title: 'Override ' + (metric.label || metric.metric_key),
            html:
                '<input type="number" step="any" id="sreOverrideValue" class="swal2-input" placeholder="Value" value="' +
                (currentValue != null ? String(currentValue).replace(/"/g, '&quot;') : '') + '">' +
                '<textarea id="sreOverrideReason" class="swal2-textarea" placeholder="Reason for overriding this figure (required)"></textarea>',
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Save override',
            preConfirm: function () {
                var valueEl = document.getElementById('sreOverrideValue');
                var reasonEl = document.getElementById('sreOverrideReason');
                var value = valueEl ? valueEl.value : '';
                var reason = reasonEl ? reasonEl.value.trim() : '';
                if (value === '' || isNaN(Number(value))) {
                    Swal.showValidationMessage('Enter a numeric value.');
                    return false;
                }
                if (!reason) {
                    Swal.showValidationMessage('A reason is required.');
                    return false;
                }
                return { value: Number(value), reason: reason };
            }
        });

        if (!result.isConfirmed || !result.value) return;

        try {
            var actorUserId = (typeof Session !== 'undefined' && Session.getUserId) ? Session.getUserId() : null;
            var outcome = await dataFunctions.overrideReportMetricValue(
                ctx.reportInstanceId,
                metric.metric_key,
                result.value.value,
                result.value.reason,
                actorUserId
            );
            if (outcome && Number(outcome.success) === 1) {
                toast('Override saved.', 'success');
                if (typeof ctx.onChanged === 'function') ctx.onChanged();
            } else {
                toast((outcome && outcome.error) || 'Could not save the override.', 'error');
            }
        } catch (e) {
            toast('The report service could not be reached. Try again in a moment.', 'error');
        }
    }

    async function clearOverride(metric, ctx) {
        if (typeof Swal === 'undefined') return;
        var confirmResult = await Swal.fire({
            icon: 'warning',
            title: 'Revert to system value?',
            text: 'This clears the entered figure and reason for ' + (metric.label || metric.metric_key) + '.',
            showCancelButton: true,
            confirmButtonText: 'Revert'
        });
        if (!confirmResult.isConfirmed) return;

        try {
            var outcome = await dataFunctions.clearReportMetricOverride(ctx.reportInstanceId, metric.metric_key);
            if (outcome && Number(outcome.success) === 1) {
                toast('Reverted to system value.', 'success');
                if (typeof ctx.onChanged === 'function') ctx.onChanged();
            } else {
                toast((outcome && outcome.error) || 'Could not revert this metric.', 'error');
            }
        } catch (e) {
            toast('The report service could not be reached. Try again in a moment.', 'error');
        }
    }

    /**
     * @param {object} metric - one entry of a section's `metrics` array from get_report_instance.
     * @param {MacReportMetricLineCtx} ctx
     * @returns {HTMLTableRowElement}
     */
    function render(metric, ctx) {
        metric = metric || {};
        ctx = ctx || {};
        var tr = document.createElement('tr');
        tr.setAttribute('data-metric-key', String(metric.metric_key || ''));

        var tdLabel = document.createElement('td');
        tdLabel.textContent = metric.label || metric.metric_key || '—';
        if (metric.division) tdLabel.title = metric.division;
        tr.appendChild(tdLabel);

        var systemFormatted = formatNumber(metric.system_value, metric.unit);
        var tdSystem = document.createElement('td');
        tdSystem.className = 'text-end';
        if (systemFormatted === null) {
            tdSystem.textContent = 'No system data';
            tdSystem.classList.add('mac-report-system-value--empty');
        } else {
            tdSystem.textContent = systemFormatted;
        }
        tr.appendChild(tdSystem);

        var tdEntered = document.createElement('td');
        tdEntered.className = 'text-end';
        var effectiveFormatted = formatNumber(metric.effective_value, metric.unit);
        var enteredSpan = document.createElement('span');
        enteredSpan.textContent = effectiveFormatted !== null ? effectiveFormatted : '—';
        tdEntered.appendChild(enteredSpan);

        if (!ctx.readOnly) {
            var editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn btn-sm btn-outline-secondary ms-2';
            editBtn.title = 'Override this figure';
            editBtn.innerHTML = '<i class="fas fa-pen"></i>';
            editBtn.addEventListener('click', function () { promptOverride(metric, ctx); });
            tdEntered.appendChild(editBtn);

            if (metric.is_overridden) {
                var clearBtn = document.createElement('button');
                clearBtn.type = 'button';
                clearBtn.className = 'btn btn-sm btn-outline-secondary ms-1';
                clearBtn.title = 'Revert to system value';
                clearBtn.innerHTML = '<i class="fas fa-rotate-left"></i>';
                clearBtn.addEventListener('click', function () { clearOverride(metric, ctx); });
                tdEntered.appendChild(clearBtn);
            }
        }
        tr.appendChild(tdEntered);

        var tdTarget = document.createElement('td');
        tdTarget.className = 'text-end';
        var targetFormatted = metric.has_target ? formatNumber(metric.target_value, metric.unit) : null;
        tdTarget.textContent = targetFormatted !== null ? targetFormatted : '—';
        tr.appendChild(tdTarget);

        var tdAchieved = document.createElement('td');
        tdAchieved.className = 'text-end';
        var achievedText = '—';
        if (metric.has_target && metric.target_value != null && Number(metric.target_value) !== 0 &&
            metric.effective_value != null) {
            var pct = (Number(metric.effective_value) / Number(metric.target_value)) * 100;
            if (isFinite(pct)) achievedText = (Math.round(pct * 10) / 10) + '%';
        }
        tdAchieved.textContent = achievedText;
        tr.appendChild(tdAchieved);

        var tdStatus = document.createElement('td');
        if (metric.is_overridden) {
            tdStatus.innerHTML = MacStatus.pill('overridden', 'Overridden');
            var whenWho = [];
            if (metric.overridden_by_name) whenWho.push(String(metric.overridden_by_name));
            if (metric.overridden_at) whenWho.push(formatTimestamp(metric.overridden_at));
            if (metric.override_reason) whenWho.push(String(metric.override_reason));
            if (whenWho.length) tdStatus.title = whenWho.join(' — ');
        } else {
            tdStatus.innerHTML = MacStatus.pill('system', 'System');
        }
        tr.appendChild(tdStatus);

        return tr;
    }

    global.MacReportMetricLine = { render: render };
})(typeof window !== 'undefined' ? window : this);
