# Terms Watch

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🔗 **Live at: [https://termswatch.io](https://termswatch.io)**

A web application that tracks and monitors changes to Terms of Service and Privacy Policies across major platforms, powered by data from [Open Terms Archive](https://opentermsarchive.org/).

## Overview

Terms Watch provides an easy-to-read interface for monitoring legal document changes from major tech platforms. It uses AI to summarize changes and helps users understand what's actually changing in the terms they agree to.

### Features

- 📊 Real-time tracking of Terms of Service and Privacy Policy changes
- 🤖 AI-powered summaries of document changes
- 🔍 Filter changes by category (Social Media, AI Platforms)
- 📅 Timeline view of recent changes
- 📰 RSS feed for subscribing to updates
- 🎨 Clean, responsive interface

## Data Sources

Terms Watch monitors two collections from Open Terms Archive:
- [Platform Governance Archive](https://opentermsarchive.org/en/collections/pga/) - Major social media and platform services
- [Generative AI Governance Archive](https://opentermsarchive.org/en/collections/genai-eu/) - AI services and platforms

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database
- GitHub Personal Access Token (for API rate limits)
- OpenRouter API key (or compatible LLM API)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/shlomihod/terms-watch.git
cd terms-watch
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment example file:
```bash
cp .env.example .env
```

4. Configure your `.env` file with:
   - Database credentials (PostgreSQL)
   - GitHub token (for higher API rate limits)
   - LLM API key (OpenRouter or compatible)
   - CRON_SECRET (random string for security)
   - NEXT_PUBLIC_APP_URL (your deployment URL)

5. Set up the database:
```bash
npx prisma migrate dev
npx prisma generate
```

6. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Deployment

The app is configured for deployment on Vercel:

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

The cron job runs automatically twice daily (configured in `vercel.json`).

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run clean:db` - Clean database (development)
- `npm run reset:db` - Reset database and set check dates

## Tech Stack

- **Framework**: Next.js
- **Database**: PostgreSQL with Prisma ORM
- **Styling**: Tailwind CSS
- **AI**: OpenRouter API (configurable)
- **Data Source**: GitHub API (Open Terms Archive repos)
- **Deployment**: Vercel

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Open Terms Archive](https://opentermsarchive.org/) for providing the data
- All contributors and maintainers of the tracked repositories