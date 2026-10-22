# Manifest coordination

OmniSpec coordinates processes on the **same machine and local filesystem**, with no external packages. This is not a distributed lock for multiple machines writing through cloud synchronization or a network share.

`specs/manifest.lock/` contains temporary, unique `<pid>-<uuid>/` claims. The root directory stays in place; empty directories do not become Git changes.

1. A participant creates its unique directory atomically. Its PID is already in the name, so a crash before any file is written still has an identifiable owner. A claim without a published ticket means the participant is choosing a number.
2. It reads existing tickets, chooses `max + 1`, and publishes the ticket by renaming a completed temporary file. Tickets use integers represented by `BigInt`.
3. It waits for choosing participants and smaller `(ticket, claim-name)` pairs before accessing the manifest. Participants arriving later observe its published ticket and choose a larger number.
4. Release requires the actual lease returned by acquisition and removes only its unique claim. There is no unlink of a shared ownership file.

This ordering follows the [Lamport bakery algorithm](https://lamport.azurewebsites.net/pubs/bakery.pdf). The implementation assumes ordinary local filesystem visibility and atomic directory creation/rename; the reference algorithm does not constitute a formal verification of this implementation.

Cleanup only treats `process.kill(pid, 0)` returning `ESRCH` as evidence of death. Age, permission errors and other failures are not evidence that a writer has stopped. Multiple cleaners can remove the same dead claim safely because its UUID path is never reused. A PID reused by an unrelated live process can conservatively delay recovery; waiting times out instead of risking concurrent writes.

The prior unpublished single-file `manifest.lock` format is handled conservatively. A valid file naming a dead PID can be replaced by the coordination directory. An empty/malformed legacy file cannot identify its owner: stop older OmniSpec processes before manually removing that legacy file, as the error instructs. Do not run old and new locking implementations against one project concurrently. New claims avoid this ambiguity by publishing the PID in the directory name.

Manifest replacement uses a completed temporary file and rename. Atomic visibility is not a promise of persistence after power loss, nor a transaction spanning the generated documents and manifest.

`test/stabilization.test.mjs` covers a live owner exceeding 15 seconds, owner death while choosing and while holding a ticket, eight concurrent recovering processes, invalid/reused releases, and mixed initialization/creation/completion operations.

## Verification lock

`verify` runs checks under a separate `specs/.omni/verify.lock/` with the same claim protocol. It holds the manifest lock only briefly: to prepare (audit, acceptance review and the *before* snapshot) and to record (the *after* snapshot and `verification.json`). Other commands keep working while checks run. A change to decisions, context, checks or source during that time fails the verification with the changed paths listed. Only one verification runs per project; a second waits about ten seconds and then reports that a verification is already running. `complete` takes the verification lock without waiting, so it never races a run. Locks are always acquired in the same order (verification, then manifest), so the two cannot deadlock.
