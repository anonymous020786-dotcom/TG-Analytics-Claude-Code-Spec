# Conceptual ERD

users 1---N sessions
users 1---N tracked_channels N---1 channels
users 1---N alerts N---1 channels
channels 1---N aliases
channels N---N categories
channels 1---N posts
posts 1---N media
users N---N organizations
roles N---N permissions
users 1---N api_keys
api_keys 1---N api_usage
plans 1---N subscriptions
subscriptions 1---N subscription_events
jobs 1---N job_attempts
jobs 0---1 dead_letter_jobs

Historical metrics live separately in analytical storage.
