#!/bin/bash

# Quick update script for when you only need to update the Lambda function code
# This is faster than a full deployment when you're just updating application code

set -e

# Configuration
PROJECT_NAME="convertfile-me"
AWS_REGION="us-east-1"
TERRAFORM_DIR="terraform"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

main() {
    log_info "Starting quick update for $PROJECT_NAME"
    
    # Get ECR URL from Terraform output
    cd $TERRAFORM_DIR
    ECR_URL=$(terraform output -raw ecr_repository_url)
    cd ..
    
    log_info "ECR URL: $ECR_URL"
    
    # Login to ECR
    log_info "Logging into ECR..."
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URL
    
    # Build Docker image
    log_info "Building Docker image..."
    docker build -t $PROJECT_NAME:latest .
    
    # Tag and push
    log_info "Tagging and pushing image..."
    docker tag $PROJECT_NAME:latest $ECR_URL:latest
    docker push $ECR_URL:latest
    
    # Update Lambda function
    log_info "Updating Lambda function..."
    LAMBDA_NAME="${PROJECT_NAME}-function"
    
    aws lambda update-function-code \
        --function-name $LAMBDA_NAME \
        --image-uri $ECR_URL:latest \
        --region $AWS_REGION
    
    # Wait for update to complete
    aws lambda wait function-updated \
        --function-name $LAMBDA_NAME \
        --region $AWS_REGION
    
    log_success "🎉 Quick update completed!"
    log_info "Your updated application is now live at https://convertfile.me"
}

main
