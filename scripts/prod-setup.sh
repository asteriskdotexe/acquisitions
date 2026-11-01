#!/bin/bash

# Production deployment script for Acquisition App
# This script starts the application in production mode with Neon Cloud Database

echo "🚀 Starting Acquisition App in Production Mode"
echo "==============================================="

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ Error: .env.production file not found!"
    echo "   Please create .env.production with your production environment variables."
    exit 1
fi

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker is not running!"
    echo "   Please start Docker and try again."
    exit 1
fi

# Run migrations against the PRODUCTION database before starting the new code.
# .env points at staging, so pass the production URL explicitly.
PROD_DATABASE_URL=$(grep '^DATABASE_URL=' .env.production | cut -d '=' -f2-)

if [ -z "$PROD_DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL is missing from .env.production"
    exit 1
fi

echo "📜 Applying latest schema to the production database..."
if ! DATABASE_URL="$PROD_DATABASE_URL" npm run db:migrate; then
    echo "❌ Migration failed. The app was not started."
    exit 1
fi

echo "📦 Building and starting production container..."
echo "   - Using Neon Cloud Database (no local proxy)"
echo "   - Running in optimized production mode"
echo ""

docker compose -f docker-compose.prod.yml up --build -d

# Give the app a moment, then make sure it didn't crash on startup
# (for example because JWT_SECRET is missing)
echo "⏳ Waiting for app to start..."
sleep 5

if [ "$(docker inspect -f '{{.State.Running}}' acquisitions-app-prod 2>/dev/null)" != "true" ]; then
    echo "❌ The app container is not running. Last logs:"
    docker logs --tail 20 acquisitions-app-prod
    exit 1
fi

echo ""
echo "🎉 Production environment started!"
echo "   Application: http://localhost:3000"
echo "   Logs: docker logs acquisitions-app-prod"
echo ""
echo "Useful commands:"
echo "   View logs: docker logs -f acquisitions-app-prod"
echo "   Stop app: docker compose -f docker-compose.prod.yml down"