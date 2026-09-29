# Telegram Integration

Use supported Telegram interfaces and only data the application is authorized to access.

Components:
TelegramClientAdapter
TelegramChannelResolver
TelegramMapper
TelegramRateLimiter
TelegramErrorClassifier

Controllers must not call Telegram SDKs directly. Track requested data, returned data, observation time, collection status and freshness.
