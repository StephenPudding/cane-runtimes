# Cane Runtime specification

`formats/` defines project, Runtime JSON, CANEB, Atlas and canonical data formats.
`runtime/` defines the language-neutral Runtime API and its animation, geometry,
affine, constraint, Physics and procedural-pose algorithms.

The target is Runtime Format 1.0 and Runtime API 1.3. The repository's
`spec-lock.json` also identifies the reference conformance suite and manifest
digest; it describes the compatibility target and is not execution evidence.
Test runners, fixture data and local verification reports are outside the public
source distribution and are not Runtime build dependencies.

The normative algorithm and format files preserve the supplied snapshot.
The [bone-animation scale clarification](corrections/bone-animation-zero-scale-20260908.json)
records the applicable amendment: finite zero animation scales retain singular
world geometry; setup Bone and Region scales retain their nonzero requirements.
Implementation and rendering boundaries are in [the architecture guide](../docs/ARCHITECTURE.md).
