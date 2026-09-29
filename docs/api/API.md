# API

Base: /api/v1

Public:
GET /channels
GET /channels/:username
GET /channels/:id/stats
GET /channels/:id/growth
GET /channels/:id/posts
GET /rankings
GET /trending

Authenticated:
GET/POST/DELETE /watchlist
GET/POST/PATCH/DELETE /alerts

Requirements: OpenAPI, validation, pagination, authorization, rate limits, stable errors, request IDs and compatibility.
