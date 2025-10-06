# Use AWS Lambda Node.js 20 base image  
FROM public.ecr.aws/lambda/nodejs:20

# Install system dependencies required for image processing
# These packages are needed for Sharp, Canvas, pdf2pic, and other image processing libraries
USER root
RUN dnf update -y && \
    dnf install -y gcc-c++ make libjpeg-turbo-devel libpng-devel giflib-devel \
    librsvg2-devel pixman-devel cairo-devel pango-devel poppler-utils \
    poppler-cpp-devel fontconfig-devel freetype-devel python3 python3-pip && \
    dnf clean all

# Create necessary directories
RUN mkdir -p /tmp && chmod 777 /tmp

# Set the working directory to the Lambda task root
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install Node.js dependencies as root first
RUN npm install --production --ignore-scripts && \
    npm cache clean --force

# Copy the rest of the application code
COPY . .

# Copy backend files specifically
COPY backend/ ./backend/
COPY public/ ./public/

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Switch back to lambda user for security
USER 1000

# Lambda handler function
CMD ["backend/lambda-handler.handler"]
