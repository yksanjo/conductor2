# fableplan

A one-line wrapper around the `claude` CLI that **plans on Fable 5 and executes on
Opus 4.8**. You get Fable's reasoning while you're shaping the work in plan mode,
then Opus 4.8 doing the actual edits — without juggling `/model` by hand.

```bash
fableplan                 # same as `claude`, but with the plan/exec split
fableplan -p "fix the flaky test"
```

## The opusplan env-var remap trick

Claude Code ships a built-in `--model opusplan` profile. It's a *router*, not a
single model: while you're in **plan mode** it uses the **opus** model slot, and
for everything else (normal editing/execution) it uses the **sonnet** slot.

We don't want Opus and Sonnet, though — we want Fable 5 planning and Opus 4.8
executing. So instead of picking those models directly, `fableplan` **remaps what
the two slots point at** using Claude Code's `ANTHROPIC_DEFAULT_*_MODEL`
environment variables, and lets `opusplan` route between them:

| opusplan phase | model slot | env var                          | fableplan default |
| -------------- | ---------- | -------------------------------- | ----------------- |
| plan mode      | opus       | `ANTHROPIC_DEFAULT_OPUS_MODEL`   | `claude-fable-5`  |
| execution      | sonnet     | `ANTHROPIC_DEFAULT_SONNET_MODEL` | `claude-opus-4-8` |

So the full command the wrapper runs is:

```bash
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-fable-5 \
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-4-8 \
claude --model opusplan "$@"
```

### Overriding the models

Both slots are overridable from the environment, so you can repurpose the same
plan-then-execute flow with any pair of models:

```bash
FABLEPLAN_PLAN_MODEL=claude-opus-4-8   fableplan   # plan on Opus instead
FABLEPLAN_EXEC_MODEL=claude-sonnet-4-6 fableplan   # cheaper execution
```

- `FABLEPLAN_PLAN_MODEL` → the opus slot (plan mode). Default `claude-fable-5`.
- `FABLEPLAN_EXEC_MODEL` → the sonnet slot (execution). Default `claude-opus-4-8`.

## Install

The script is a self-contained bash file — no build step. The quickest install
is an alias pointing straight at it:

```bash
# one-liner: add an alias to your shell profile
echo "alias fableplan='$(pwd)/bin/fableplan'" >> ~/.zshrc && source ~/.zshrc
```

(Use `~/.bashrc` instead of `~/.zshrc` on bash.) Or drop it on your `PATH`:

```bash
chmod +x bin/fableplan
ln -s "$(pwd)/bin/fableplan" /usr/local/bin/fableplan
```

Then just run `fableplan` anywhere you'd run `claude`.

## Caveat: `/model` aliases get remapped mid-session

Because the remap works by **redefining what the `opus` and `sonnet` slots
point at**, the friendly `/model` aliases inside a running session are remapped
too. Inside a `fableplan` session:

- `/model opus`   actually selects **Fable 5** (whatever `FABLEPLAN_PLAN_MODEL` is).
- `/model sonnet` actually selects **Opus 4.8** (whatever `FABLEPLAN_EXEC_MODEL` is).

So if you switch models by name mid-session expecting stock Opus or Sonnet,
you'll get the remapped models instead. To pin a literal model, pass its full id
(e.g. `/model claude-sonnet-4-6`) rather than the `opus`/`sonnet` alias.
