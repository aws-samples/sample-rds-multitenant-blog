#!/bin/bash

# Function to handle errors
error_exit() {
    echo "Error: $1" >&2
    exit 1
}

# Check if correct number of parameters are provided
if [ $# -ne 4 ]; then
    error_exit "Usage: $0 <mode> <glueCURDBName> <glueCURDBTable> <region>
    mode: deploy or destroy
    glueCURDBName: Name of the Glue CUR database
    glueCURDBTable: Name of the Glue CUR table
    region: AWS region for deployment"
fi

# Assign parameters to variables
mode=$1
glueCURDBName=$2
glueCURDBTable=$3
region=$4

# Validate mode parameter
if [ "$mode" != "deploy" ] && [ "$mode" != "destroy" ]; then
    error_exit "Invalid mode. Must be either 'deploy' or 'destroy'"
fi

#set the AWS_REGION env variable to the region selected
export AWS_REGION=${region}

# Execute commands and check for errors
if [ "$mode" = "deploy" ]; then
    npx cdk deploy RdsMultitenantPIStack -c glueCURDBName=${glueCURDBName} -c glueCURDBTable=${glueCURDBTable} --region ${region} --require-approval never || error_exit "deploy RdsMultitenantPIStack failed"
    npx cdk deploy RdsMultitenantAthenaViewsStack -c glueCURDBName=${glueCURDBName} -c glueCURDBTable=${glueCURDBTable} --require-approval never || error_exit "deploy RdsMultitenantAthenaViewsStack failed"
else
    npx cdk destroy RdsMultitenantPIStack -c glueCURDBName=${glueCURDBName} -c glueCURDBTable=${glueCURDBTable} --region ${region} --force || error_exit "destroy RdsMultitenantPIStack failed"
    npx cdk destroy RdsMultitenantAthenaViewsStack -c glueCURDBName=${glueCURDBName} -c glueCURDBTable=${glueCURDBTable} --force || error_exit "destroy RdsMultitenantAthenaViewsStack failed"
fi

# If all commands succeed, print success message
echo "All commands completed successfully"
