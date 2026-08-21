// Feature modules that register their own message handlers with the router
// (see router.registerHandler). Each is self-contained — its own DB tables
// (CREATE TABLE IF NOT EXISTS at load), its own state, its own messages.
// Append a require here when adding one; keep them alphabetical.

require('./handlers/buddy');
require('./handlers/fame');
require('./handlers/trade');
require('./handlers/guild');
