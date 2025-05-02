# JSON Translation API

A powerful NestJS-based API service for translating JSON data between different languages. This service provides a robust solution for handling translation requests with features like API key authentication, usage tracking, and subscription management.

## Features

- **JSON Translation**: Translate JSON data between multiple languages while preserving the structure
- **API Key Authentication**: Secure access control through API keys
- **Usage Tracking**: Monitor and track API usage for each user
- **Subscription Management**: Different subscription tiers with varying limits
- **Webhook Support**: Receive translation results via webhooks
- **Queue Processing**: Efficient handling of translation requests using Bull queue
- **Rate Limiting**: Prevent abuse through rate limiting
- **Error Handling**: Comprehensive error handling and logging

## Prerequisites

- Node.js (v16 or later)
- npm or yarn
- Redis (for queue processing)
- PostgreSQL (for data storage)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/jamesfeng2009/json_translation_api.git
cd json_translation_api
```

2. Install dependencies:
```bash
npm install
```

3. Create environment files:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=your_username
DB_PASSWORD=your_password
DB_DATABASE=your_database

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRATION=1d

# API Key
API_KEY_PREFIX=your_prefix
API_KEY_LENGTH=32

# Application
PORT=3000
NODE_ENV=development
```

5. Start the application:
```bash
npm run start:dev
```

## API Documentation

### Authentication

All API endpoints require authentication using either:
- JWT token (for user management)
- API key (for translation services)

### Endpoints

#### Translation

- `POST /api/translate`
  - Translate JSON data
  - Required: API key, source text, target language
  - Optional: source language (auto-detected if not provided)

#### User Management

- `POST /api/auth/register`
  - Register a new user
- `POST /api/auth/login`
  - Login and get JWT token
- `GET /api/user/profile`
  - Get user profile (requires JWT)
- `GET /api/user/usage`
  - Get usage statistics (requires JWT)

#### API Key Management

- `POST /api/user/api-keys`
  - Generate new API key (requires JWT)
- `GET /api/user/api-keys`
  - List API keys (requires JWT)
- `DELETE /api/user/api-keys/:id`
  - Revoke API key (requires JWT)

#### Subscription Management

- `GET /api/subscription/plans`
  - List available subscription plans
- `GET /api/subscription/current`
  - Get current subscription (requires JWT)
- `POST /api/subscription/upgrade`
  - Upgrade subscription plan (requires JWT)

## Project Structure

```
src/
├── config/           # Configuration files
├── entities/         # Database entities
├── modules/          # Feature modules
│   ├── auth/         # Authentication module
│   ├── user/         # User management
│   ├── api-key/      # API key management
│   ├── subscription/ # Subscription management
│   └── translation/  # Translation service
├── common/           # Common utilities and decorators
└── main.ts          # Application entry point
```

## Development

### Running Tests

```bash
npm run test
```

### Building for Production

```bash
npm run build
```

### Starting Production Server

```bash
npm run start:prod
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, please open an issue in the GitHub repository or contact the maintainers. 