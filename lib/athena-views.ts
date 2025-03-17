export const ATHENA_VIEW_PI_DATA = (
    glueDBName: string,
    piDBView: string = "pi_data_view",
    piDBTable: string = "rds_pi_data_hourly") => `
create or replace view "AwsDataCatalog"."${glueDBName}"."${piDBView}" as 
    WITH aggregate_load_data AS (
        SELECT 
            timestamp,
            resourcearn,
            AVG(num_vcpus) AS num_vcpus,
            SUM(value) AS total_db_load,
            greatest(AVG(num_vcpus), SUM(value)) total_compute_power,
            count(1) AS num_users
        FROM "AwsDataCatalog"."${glueDBName}"."${piDBTable}" 
        GROUP BY 1, 2
    ) 
    SELECT 
        b.timestamp,
        b.account_id, 
        b.resourcearn,
        b.num_vcpus,
        b."db.user.name"    as user_name, 
        b.value db_load, 
        a.total_db_load,
        a.total_compute_power,
        a.num_users distinct_users,
        case when a.total_db_load = 0 then 0 else  b.value / a.total_db_load end AS perc_utilization,
        (b.value / a.total_compute_power) perc_utilization_rebased
    FROM aggregate_load_data a 
    JOIN "AwsDataCatalog"."${glueDBName}"."${piDBTable}" b
        ON a.timestamp = b.timestamp AND a.resourcearn = b.resourcearn
        `


export const ATHENA_VIEW_COST_ALLOCATION = (
    glueDBName: string,
    glueCURDBName: string, 
    CURDBTable: string,
    piDBView: string = "pi_data_view",
    costAllocationViewName: string = "rds_cost_allocation_view") => `
    CREATE OR REPLACE VIEW "${costAllocationViewName}" AS 
    SELECT
        cur.line_item_usage_start_date                                  as timestamp,
        pi_view.user_name                                               as tenant_id,
        CASE WHEN cur.line_item_line_item_type = 'DiscountedUsage' THEN cur.reservation_effective_cost    WHEN cur.line_item_line_item_type = 'RIFee' THEN cur.reservation_unused_amortized_upfront_fee_for_billing_period + cur.reservation_unused_recurring_fee    WHEN cur.line_item_line_item_type = 'Fee' AND cur.reservation_reservation_a_r_n <> '' THEN 0    ELSE cur.line_item_unblended_cost   END                                    as database_cost,
        pi_view.perc_utilization_rebased * CASE WHEN cur.line_item_line_item_type = 'DiscountedUsage' THEN cur.reservation_effective_cost    WHEN cur.line_item_line_item_type = 'RIFee' THEN cur.reservation_unused_amortized_upfront_fee_for_billing_period + cur.reservation_unused_recurring_fee    WHEN cur.line_item_line_item_type = 'Fee' AND cur.reservation_reservation_a_r_n <> '' THEN 0    ELSE cur.line_item_unblended_cost   END as tenant_cost,
        pi_view.total_compute_power,
        pi_view.perc_utilization_rebased                                as perc_utilization_rebased,
        cur.line_item_usage_type,
        cur.line_item_line_item_type,
        cur.line_item_resource_id,
        cur.product['database_engine'] product_database_engine,
        cur.product_instance_type
    FROM "AwsDataCatalog"."${glueCURDBName}"."${CURDBTable}" cur
    INNER JOIN "AwsDataCatalog"."${glueDBName}"."${piDBView}" pi_view ON 
        cur.line_item_resource_id = pi_view.resourcearn AND
        cur.line_item_usage_start_date = CAST(pi_view.timestamp AS timestamp)
    WHERE cur.line_item_product_code = 'AmazonRDS' AND cur.product_instance_type <> ''
    `

export const ATHENA_VIEW_UNUSED_COST = (
    glueDBName: string,
    costAllocationViewName: string = "rds_cost_allocation_view",
    unusedCostsViewName: string = "rds_unused_cost_view") => `
CREATE OR REPLACE VIEW "${unusedCostsViewName}" AS 
    SELECT 
        date_trunc('hour' , timestamp)          as timestamp, 
        max(database_cost)                      as database_cost,
        sum(perc_utilization_rebased)           as database_usage, 
        1-sum(perc_utilization_rebased)         as unused_percentage,
        max(database_cost) - sum(tenant_cost)   as unused_cost
    FROM "AwsDataCatalog"."${glueDBName}"."${costAllocationViewName}"  
        group by date_trunc('hour' , timestamp)
`
