# Native Core performance and packet ownership

The player keeps owned, immutable Frame and RenderPacket values. Retaining either
value prevents changes to its publication; copying a handle retains that owner. References returned by accessors remain borrowed from their containing owner. Each player has one writer, and different players have independent workspaces.

The packet builder caches two recent geometry buffers. It may borrow a buffer
only when the cache is its sole owner. The Core modifier stage finishes all
changes and validation before a const packet owner is published. While any old
Frame or RenderPacket still holds the buffer, the builder allocates another
buffer and can evict only its own cache reference. This keeps the cache bounded
without limiting retained publications or introducing an ephemeral-frame API. Destroying a player or builder cannot invalidate a retained publication.

Unobserved buffers retain vertex, UV, index, triangle-facing and string capacity. Every draw overwrites current identity, texture variant, tint, affine and geometry;
the final attachment count removes old hidden/clipped draws. Texture metadata is
assigned in place. A failed candidate may leave private cache contents changed,
but the previous publication remains owned and the next build replaces the failed
contents from its newly evaluated pose. Animation, constraints, clipping, Atlas
mapping, tint composition and winding algorithms are unchanged.

The full player still allocates for owned pose/frame state and transactional
playback copies. Retaining every frame, increasing topology, first-use features,
events, effects and resource changes can require additional storage.
