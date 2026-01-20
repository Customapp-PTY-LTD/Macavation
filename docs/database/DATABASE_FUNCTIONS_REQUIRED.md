# Database Functions Required for Process-Driven Design

This document lists the database functions that need to be created in Supabase to support the Process-Driven Design features.

## Workflow Views Functions

### get_workflow_tasks
Get workflow tasks for a specific role.

```sql
CREATE OR REPLACE FUNCTION get_workflow_tasks(p_role VARCHAR)
RETURNS TABLE (
    id UUID,
    title VARCHAR,
    description TEXT,
    status VARCHAR,
    scheduled_time TIME,
    action_url VARCHAR,
    action_label VARCHAR,
    context TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wt.id,
        wt.title,
        wt.description,
        wt.status,
        wt.scheduled_time,
        wt.action_url,
        wt.action_label,
        wt.context
    FROM workflow_tasks wt
    WHERE wt.role = p_role
    AND wt.status != 'completed'
    AND (wt.scheduled_date = CURRENT_DATE OR wt.scheduled_date IS NULL)
    ORDER BY wt.scheduled_time ASC NULLS LAST;
END;
$$;
```

### get_watching_items
Get items being watched for proactive intelligence.

```sql
CREATE OR REPLACE FUNCTION get_watching_items(p_role VARCHAR)
RETURNS TABLE (
    id UUID,
    title VARCHAR,
    description TEXT,
    insight TEXT,
    trend DECIMAL,
    trend_period VARCHAR,
    action_url VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wi.id,
        wi.title,
        wi.description,
        wi.insight,
        wi.trend,
        wi.trend_period,
        wi.action_url
    FROM watching_items wi
    WHERE wi.role = p_role
    AND wi.is_active = true
    ORDER BY wi.priority DESC, wi.created_at DESC;
END;
$$;
```

### get_due_items
Get items due for a role.

```sql
CREATE OR REPLACE FUNCTION get_due_items(p_role VARCHAR)
RETURNS TABLE (
    id UUID,
    title VARCHAR,
    description TEXT,
    due_date DATE,
    is_overdue BOOLEAN,
    action_url VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        di.id,
        di.title,
        di.description,
        di.due_date,
        di.due_date < CURRENT_DATE AS is_overdue,
        di.action_url
    FROM due_items di
    WHERE di.role = p_role
    AND di.due_date <= CURRENT_DATE + INTERVAL '7 days'
    AND di.status != 'completed'
    ORDER BY di.due_date ASC;
END;
$$;
```

### get_recent_activity_by_role
Get recent activity for a role.

```sql
CREATE OR REPLACE FUNCTION get_recent_activity_by_role(p_role VARCHAR, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    type VARCHAR,
    title VARCHAR,
    description TEXT,
    timestamp TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ra.id,
        ra.type,
        ra.title,
        ra.description,
        ra.timestamp
    FROM recent_activity ra
    WHERE ra.role = p_role
    ORDER BY ra.timestamp DESC
    LIMIT p_limit;
END;
$$;
```

### update_workflow_task
Update workflow task status.

```sql
CREATE OR REPLACE FUNCTION update_workflow_task(
    p_task_id UUID,
    p_status VARCHAR
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE workflow_tasks
    SET status = p_status,
        updated_at = NOW()
    WHERE id = p_task_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Task updated successfully'
    );
END;
$$;
```

## Connected Workflows Functions

### get_downstream_impacts
Get downstream impacts for an action.

```sql
CREATE OR REPLACE FUNCTION get_downstream_impacts(
    p_entity_type VARCHAR,
    p_entity_id UUID,
    p_action VARCHAR
)
RETURNS TABLE (
    id UUID,
    entity_type VARCHAR,
    entity_id UUID,
    type VARCHAR,
    severity VARCHAR,
    title VARCHAR,
    description TEXT,
    action_required TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        di.id,
        di.entity_type,
        di.entity_id,
        di.type,
        di.severity,
        di.title,
        di.description,
        di.action_required
    FROM downstream_impacts di
    WHERE di.source_entity_type = p_entity_type
    AND di.source_entity_id = p_entity_id
    AND di.action = p_action
    AND di.is_active = true;
END;
$$;
```

### get_linked_records
Get linked records for an entity.

```sql
CREATE OR REPLACE FUNCTION get_linked_records(
    p_entity_type VARCHAR,
    p_entity_id UUID
)
RETURNS TABLE (
    id UUID,
    entity_type VARCHAR,
    title VARCHAR,
    description TEXT,
    status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        lr.id,
        lr.linked_entity_type AS entity_type,
        lr.title,
        lr.description,
        lr.status
    FROM linked_records lr
    WHERE lr.source_entity_type = p_entity_type
    AND lr.source_entity_id = p_entity_id
    AND lr.is_active = true;
END;
$$;
```

### check_action_conflicts
Check for conflicts before an action.

```sql
CREATE OR REPLACE FUNCTION check_action_conflicts(
    p_entity_type VARCHAR,
    p_entity_id UUID,
    p_action VARCHAR,
    p_data JSONB
)
RETURNS TABLE (
    id UUID,
    title VARCHAR,
    description TEXT,
    message TEXT,
    resolution TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.title,
        c.description,
        c.message,
        c.resolution
    FROM action_conflicts c
    WHERE c.entity_type = p_entity_type
    AND c.entity_id = p_entity_id
    AND c.action = p_action
    AND c.is_active = true;
END;
$$;
```

## Proactive Intelligence Functions

### get_trend_projection
Get trend projection for a metric.

```sql
CREATE OR REPLACE FUNCTION get_trend_projection(
    p_metric_name VARCHAR,
    p_entity_id UUID DEFAULT NULL,
    p_periods INTEGER DEFAULT 4
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current DECIMAL;
    v_projected DECIMAL;
    v_trend DECIMAL;
BEGIN
    -- Get current value
    SELECT value INTO v_current
    FROM metric_values
    WHERE metric_name = p_metric_name
    AND (entity_id = p_entity_id OR p_entity_id IS NULL)
    ORDER BY recorded_at DESC
    LIMIT 1;
    
    -- Calculate trend (simplified - should use proper regression)
    SELECT AVG(change_percentage) INTO v_trend
    FROM (
        SELECT 
            (value - LAG(value) OVER (ORDER BY recorded_at)) / NULLIF(LAG(value) OVER (ORDER BY recorded_at), 0) * 100 AS change_percentage
        FROM metric_values
        WHERE metric_name = p_metric_name
        AND (entity_id = p_entity_id OR p_entity_id IS NULL)
        ORDER BY recorded_at DESC
        LIMIT 10
    ) trend_calc;
    
    -- Project future value
    v_projected := v_current * (1 + (v_trend / 100) * p_periods);
    
    RETURN json_build_object(
        'current', v_current,
        'projected', v_projected,
        'trend', COALESCE(v_trend, 0),
        'periodsAhead', p_periods
    );
END;
$$;
```

### get_predictive_insights
Get predictive insights for an entity.

```sql
CREATE OR REPLACE FUNCTION get_predictive_insights(
    p_entity_type VARCHAR,
    p_entity_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    type VARCHAR,
    severity VARCHAR,
    title VARCHAR,
    description TEXT,
    projection TEXT,
    suggested_action TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pi.id,
        pi.type,
        pi.severity,
        pi.title,
        pi.description,
        pi.projection,
        pi.suggested_action
    FROM predictive_insights pi
    WHERE pi.entity_type = p_entity_type
    AND (pi.entity_id = p_entity_id OR p_entity_id IS NULL)
    AND pi.is_active = true
    ORDER BY 
        CASE pi.severity
            WHEN 'critical' THEN 1
            WHEN 'warning' THEN 2
            WHEN 'info' THEN 3
            ELSE 4
        END,
        pi.created_at DESC;
END;
$$;
```

## Compliance Validation Functions

### check_compliance
Check compliance requirements for an action.

```sql
CREATE OR REPLACE FUNCTION check_compliance(
    p_entity_type VARCHAR,
    p_action VARCHAR,
    p_data JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_violations JSONB := '[]'::JSONB;
    v_violation JSONB;
BEGIN
    -- Check compliance rules
    FOR v_violation IN
        SELECT jsonb_build_object(
            'requirement', cr.requirement_name,
            'message', cr.violation_message,
            'description', cr.description,
            'resolution', cr.resolution_guidance
        )
        FROM compliance_rules cr
        WHERE cr.entity_type = p_entity_type
        AND cr.action = p_action
        AND cr.is_active = true
        AND NOT cr.check_compliance(p_data)
    LOOP
        v_violations := v_violations || jsonb_build_array(v_violation);
    END LOOP;
    
    RETURN json_build_object(
        'compliant', jsonb_array_length(v_violations) = 0,
        'violations', v_violations
    );
END;
$$;
```

### get_expiring_certifications
Get expiring certifications.

```sql
CREATE OR REPLACE FUNCTION get_expiring_certifications(p_days_ahead INTEGER DEFAULT 30)
RETURNS TABLE (
    id UUID,
    name VARCHAR,
    title VARCHAR,
    description TEXT,
    expiry_date DATE,
    days_until_expiry INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.name,
        c.title,
        c.description,
        c.expiry_date,
        (c.expiry_date - CURRENT_DATE)::INTEGER AS days_until_expiry
    FROM certifications c
    WHERE c.expiry_date <= CURRENT_DATE + (p_days_ahead || ' days')::INTERVAL
    AND c.expiry_date >= CURRENT_DATE
    AND c.is_active = true
    ORDER BY c.expiry_date ASC;
END;
$$;
```

### check_field_compliance
Check field-level compliance.

```sql
CREATE OR REPLACE FUNCTION check_field_compliance(
    p_field_name VARCHAR,
    p_value TEXT,
    p_entity_type VARCHAR
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_compliant BOOLEAN := true;
    v_message TEXT := NULL;
BEGIN
    -- Check field-specific compliance rules
    SELECT 
        false,
        cr.violation_message
    INTO v_compliant, v_message
    FROM field_compliance_rules cr
    WHERE cr.field_name = p_field_name
    AND cr.entity_type = p_entity_type
    AND cr.is_active = true
    AND NOT cr.check_value(p_value)
    LIMIT 1;
    
    RETURN json_build_object(
        'compliant', COALESCE(v_compliant, true),
        'message', v_message
    );
END;
$$;
```

## Database Tables Required

### workflow_tasks
```sql
CREATE TABLE workflow_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    status VARCHAR DEFAULT 'pending',
    scheduled_date DATE,
    scheduled_time TIME,
    action_url VARCHAR,
    action_label VARCHAR,
    context TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### watching_items
```sql
CREATE TABLE watching_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    insight TEXT,
    trend DECIMAL,
    trend_period VARCHAR,
    action_url VARCHAR,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### due_items
```sql
CREATE TABLE due_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    due_date DATE NOT NULL,
    status VARCHAR DEFAULT 'pending',
    action_url VARCHAR,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### recent_activity
```sql
CREATE TABLE recent_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR NOT NULL,
    type VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
```

### downstream_impacts
```sql
CREATE TABLE downstream_impacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_entity_type VARCHAR NOT NULL,
    source_entity_id UUID NOT NULL,
    entity_type VARCHAR NOT NULL,
    entity_id UUID,
    action VARCHAR NOT NULL,
    type VARCHAR NOT NULL,
    severity VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    action_required TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### linked_records
```sql
CREATE TABLE linked_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_entity_type VARCHAR NOT NULL,
    source_entity_id UUID NOT NULL,
    linked_entity_type VARCHAR NOT NULL,
    linked_entity_id UUID NOT NULL,
    title VARCHAR,
    description TEXT,
    status VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### action_conflicts
```sql
CREATE TABLE action_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR NOT NULL,
    entity_id UUID,
    action VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    description TEXT,
    message TEXT NOT NULL,
    resolution TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### compliance_rules
```sql
CREATE TABLE compliance_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR NOT NULL,
    action VARCHAR NOT NULL,
    requirement_name VARCHAR NOT NULL,
    violation_message TEXT NOT NULL,
    description TEXT,
    resolution_guidance TEXT,
    check_function VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### certifications
```sql
CREATE TABLE certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR NOT NULL,
    title VARCHAR,
    description TEXT,
    expiry_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Notes

1. These functions should be created in Supabase SQL Editor
2. RBAC permissions need to be added for each function
3. Some functions may need to be customized based on actual data structures
4. The compliance checking logic may need to be implemented as stored procedures or application logic
5. Indexes should be added for performance on frequently queried columns

