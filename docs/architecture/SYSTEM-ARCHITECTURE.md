# System Architecture

Telegram supported interfaces
-> discovery/ingestion workers
-> durable queues
-> PostgreSQL + ClickHouse + object storage
-> analytics engine
-> search/API/cache
-> Next.js public site/dashboard
-> Telegram bot/users.

Start as a modular monolith plus workers. Extract services only after measured bottlenecks.
