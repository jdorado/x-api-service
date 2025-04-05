# X-API Service

A RESTful API wrapper for the Twitter/X platform that provides a straightforward interface for interacting with Twitter services. Built on top of the [`agent-twitter-client`](https://github.com/elizaOS/agent-twitter-client) library. Twitter API Service's primary value is simplifying Twitter/X integration through an easy-to-deploy containerized REST API via Docker. It handles the complexity of Twitter's authentication by persisting cookies in MongoDB, enabling reliable session management across multiple containers. This approach eliminates the need for applications to implement Twitter's complex authentication flow directly, making integration significantly easier and more maintainable.

## Features

- Login and get profile information
- Get user timeline
- Get home timeline
- Search tweets
- Post tweets and polls
- View specific tweets
- Interactive API documentation at `/docs` endpoint

## Setup Instructions

### 1. Run Locally with Local MongoDB

#### Prerequisites
- Node.js v18 or higher
- MongoDB installed locally or available on a server

#### Steps

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

3. Update the `.env` file with your MongoDB connection string:
   ```
   PORT=6011
   MONGO_CONNECTION=mongodb://localhost:27017/x-api
   ```

4. Start the application:
   ```bash
   npm start
   ```

5. The API will be available at `http://localhost:6011`

### 2. Run with Docker Compose (includes MongoDB)

#### Prerequisites
- Docker and Docker Compose installed

#### Steps

1. Start the services with Docker Compose:
   ```bash
   docker-compose up -d
   ```

   The Docker Compose setup automatically:
   - Uses the MongoDB container as the database
   - Maps the correct port for API access
   - Manages environment variables between containers

2. The API will be available at `http://localhost:6011`

#### Rebuilding the Containers

If you need to rebuild the containers after code changes:

```bash
docker-compose down && docker-compose build x-api && docker-compose up -d --build
```

### 3. Deploy to Cloud

#### Prerequisites
- Docker installed on the cloud server
- MongoDB instance available (MongoDB Atlas, AWS DocumentDB, self-hosted, etc.)

#### Steps

1. Create a `.env` file with your production configuration:
   ```bash
   cat << EOF > .env
   PORT=6011
   MONGO_CONNECTION=mongodb+srv://username:password@your-mongo-instance.mongodb.net/x-api
   EOF
   ```

2. Build and run the Docker container:
   ```bash
   docker build -t twitter-api-service .
   docker run -d --name twitter-api-service -p 6011:6011 \
     -v $(pwd)/cookies:/app/cookies \
     -v $(pwd)/.env:/app/.env \
     --restart unless-stopped \
     twitter-api-service
   ```

3. Optional: Set up a reverse proxy (Nginx or similar) with HTTPS for production use.

## API Documentation

The API includes an interactive documentation interface accessible at `/docs` after starting the application:

- Local: http://localhost:6011/docs
- Docker: http://localhost:6011/docs
- Cloud: http://your-domain.com/docs (if using a domain)

This Swagger UI provides:
- Complete documentation of all endpoints
- Request/response schemas
- The ability to test API calls directly from the browser

## API Endpoints

- `GET /health` - Health check endpoint
- `POST /api/login` - Login and get profile/cookies
- `POST /api/profile/:user` - Get a specific user's profile
- `POST /api/tweets/:userId` - Get user's tweets
- `POST /api/timeline` - Get home timeline
- `POST /api/search` - Search tweets
- `POST /api/tweet` - Post a tweet
- `POST /api/tweet/poll` - Post a tweet with a poll
- `POST /api/tweet/:id` - Get a specific tweet

## Authentication

All API endpoints (except `/health`) require Twitter credentials in the request body:

```json
{
  "username": "your_twitter_username",
  "password": "your_twitter_password"
}
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This project is not affiliated with, maintained, authorized, endorsed, or sponsored by Twitter, Inc. or any of its affiliates.