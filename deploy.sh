#!/bin/bash

# Convertfile.me Deployment Script
# This script builds and deploys the application to AWS

set -e  # Exit on any error

# Configuration
PROJECT_NAME="convertfile-me"
AWS_REGION="us-east-1"
TERRAFORM_DIR="terraform"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_dependencies() {
    log_info "Checking dependencies..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check if Terraform is installed
    if ! command -v terraform &> /dev/null; then
        log_error "Terraform is not installed. Please install it first."
        exit 1
    fi
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install it first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    log_success "All dependencies are available"
}

create_terraform_vars() {
    if [ ! -f "$TERRAFORM_DIR/terraform.tfvars" ]; then
        log_info "Creating terraform.tfvars from example..."
        cp "$TERRAFORM_DIR/terraform.tfvars.example" "$TERRAFORM_DIR/terraform.tfvars"
        
        # Read MongoDB URI from .env file if it exists
        if [ -f ".env" ]; then
            MONGODB_URI=$(grep "MONGODB_URI=" .env | cut -d '=' -f2-)
            if [ ! -z "$MONGODB_URI" ]; then
                echo "mongodb_uri = \"$MONGODB_URI\"" >> "$TERRAFORM_DIR/terraform.tfvars"
                log_info "Added MongoDB URI from .env file"
            fi
        fi
        
        log_warning "Please edit $TERRAFORM_DIR/terraform.tfvars with your specific values before continuing"
        log_warning "Press Enter to continue after editing the file..."
        read
    fi
}

init_terraform() {
    log_info "Initializing Terraform..."
    cd $TERRAFORM_DIR
    terraform init
    cd ..
    log_success "Terraform initialized"
}

plan_terraform() {
    log_info "Planning Terraform deployment..."
    cd $TERRAFORM_DIR
    terraform plan -out=tfplan
    cd ..
    log_success "Terraform plan created"
}

apply_terraform() {
    log_info "Applying Terraform configuration..."
    cd $TERRAFORM_DIR
    terraform apply tfplan
    cd ..
    log_success "Terraform applied successfully"
}

get_ecr_url() {
    log_info "Getting ECR repository URL..."
    cd $TERRAFORM_DIR
    ECR_URL=$(terraform output -raw ecr_repository_url)
    cd ..
    echo $ECR_URL
}

login_to_ecr() {
    log_info "Logging into ECR..."
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $1
    log_success "Logged into ECR"
}

build_and_push_docker() {
    local ecr_url=$1
    
    log_info "Building Docker image..."
    docker build -t $PROJECT_NAME:latest .
    
    log_info "Tagging Docker image..."
    docker tag $PROJECT_NAME:latest $ecr_url:latest
    
    log_info "Pushing Docker image to ECR..."
    docker push $ecr_url:latest
    
    log_success "Docker image pushed successfully"
}

update_lambda() {
    log_info "Updating Lambda function..."
    LAMBDA_NAME="${PROJECT_NAME}-function"
    
    # Wait a moment for ECR to be ready
    sleep 10
    
    # Update Lambda function code
    aws lambda update-function-code \
        --function-name $LAMBDA_NAME \
        --image-uri $(get_ecr_url):latest \
        --region $AWS_REGION
    
    # Wait for update to complete
    aws lambda wait function-updated \
        --function-name $LAMBDA_NAME \
        --region $AWS_REGION
    
    log_success "Lambda function updated"
}

show_outputs() {
    log_info "Deployment completed! Here are your endpoints:"
    cd $TERRAFORM_DIR
    
    echo ""
    echo "🌐 Custom Domain: $(terraform output -raw custom_domain_url)"
    echo "🔗 API Gateway: $(terraform output -raw api_gateway_url)"
    echo "⚡ Lambda Function URL: $(terraform output -raw lambda_function_url)"
    echo "🐳 ECR Repository: $(terraform output -raw ecr_repository_url)"
    echo "📊 CloudWatch Logs: $(terraform output -raw cloudwatch_log_group)"
    echo ""
    
    cd ..
}

# Main deployment flow
main() {
    log_info "Starting deployment for $PROJECT_NAME"
    
    # Check dependencies
    check_dependencies
    
    # Create terraform.tfvars if it doesn't exist
    create_terraform_vars
    
    # Initialize Terraform
    init_terraform
    
    # Plan Terraform
    plan_terraform
    
    # Apply Terraform (this creates infrastructure)
    apply_terraform
    
    # Get ECR URL
    ECR_URL=$(get_ecr_url)
    log_info "ECR URL: $ECR_URL"
    
    # Login to ECR
    login_to_ecr $ECR_URL
    
    # Build and push Docker image
    build_and_push_docker $ECR_URL
    
    # Update Lambda function
    update_lambda
    
    # Show final outputs
    show_outputs
    
    log_success "🎉 Deployment completed successfully!"
    log_info "Your application should now be available at https://convertfile.me"
}

# Handle script arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "build-only")
        check_dependencies
        ECR_URL=$(get_ecr_url)
        login_to_ecr $ECR_URL
        build_and_push_docker $ECR_URL
        update_lambda
        ;;
    "terraform-only")
        check_dependencies
        create_terraform_vars
        init_terraform
        plan_terraform
        apply_terraform
        ;;
    "destroy")
        log_warning "This will destroy all AWS resources. Are you sure? (y/N)"
        read -r response
        if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            cd $TERRAFORM_DIR
            terraform destroy
            cd ..
            log_success "Resources destroyed"
        else
            log_info "Destruction cancelled"
        fi
        ;;
    *)
        echo "Usage: $0 [deploy|build-only|terraform-only|destroy]"
        echo "  deploy       - Full deployment (default)"
        echo "  build-only   - Only build and push Docker image"
        echo "  terraform-only - Only run Terraform"
        echo "  destroy      - Destroy all resources"
        exit 1
        ;;
esac
