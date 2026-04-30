# Household — regex command grammar

The "fast path" for incoming messages.  Stream 1b
(`regexCommands.js`) implements this.  When the LLM is later wired
in (Phase 3), unparsed messages fall through to the slow path.

## Conventions

- All commands are case-insensitive on the verb.
- Type names + the verb support **English and Dutch**.  Dutch
  synonyms are listed alongside English ones.
- Whitespace is collapsed (`/\s+/` → ` `) before matching.
- Leading punctuation (`!`, `/`, `@household`) is stripped before
  matching — see "Addressed-mode prefixes" below.
- Regex mode: ASCII text, `\b` word boundaries.  Unicode characters
  in the *text* part of items are preserved verbatim; matching only
  cares about the verb + type slot.

## Addressed-mode prefixes (stripped before matching)

The bridge has already verified the message is addressed (Q-H2.4
lock); the parser doesn't need to gate on this.  But the user may
optionally start with any of:

- `@Household ` (Telegram mention; case-insensitive)
- `/` (Telegram slash-command style)
- `!` (informal command prefix)

Strip a leading prefix once before matching.

## Verbs

### `add <type> <text>`

Add an open item.

- English: `add`
- Dutch: `voeg toe`, `toevoegen`, `noteer`

Examples:
- `add shopping bread`
- `voeg toe shopping melk`
- `/add errand pick up dry cleaning friday`

Skill: `addItem({ type, text })`.

### `list <type>` / `wat hebben we nodig` / `what do we need`

List open items of a type.

- English: `list <type>`, `show <type>`, `what do we need [in/at <where>]?`
- Dutch: `lijst <type>`, `toon <type>`, `wat hebben we nodig [in/op <waar>]?`

The "what do we need" form maps to `type='shopping'` regardless of
suffix (per Q-H2 user framing; "at the supermarket" is the canonical
example).

Examples:
- `list shopping`
- `what do we need?`
- `wat hebben we nodig in de supermarkt?`

Skill: `listOpen({ type })`.

### `done <id-or-keyword>` / `klaar`

Mark an open item complete.  Match by id (8-char ULID prefix) or
by exact text or by fuzzy keyword.  Ambiguity (multiple matches) →
return the candidates instead of completing.

- English: `done`, `complete`, `bought`, `did`, `finished`
- Dutch: `klaar`, `gedaan`, `gekocht`

Examples:
- `done bread`
- `klaar melk`
- `bought eggs and bread`  → matches both items if both are open

Skill: `markComplete({ match })`.

### `remove <id-or-keyword>`

Hard-delete (different from `done`; use when the item shouldn't be
there at all).

- English: `remove`, `delete`, `cancel`, `nope`
- Dutch: `verwijder`, `weg`

Skill: `removeItem({ match })`.

### `help` / `hulp`

Print the command list.

Skill: `help({})`.

## Type vocabulary

The `<type>` slot accepts:

| Type slot       | Aliases (English)                  | Aliases (Dutch)                 |
|-----------------|-------------------------------------|----------------------------------|
| `shopping`      | `groceries`, `shopping`, `buy`     | `boodschappen`, `winkel`        |
| `errand`        | `errand`, `task`, `todo`           | `klusje`, `boodschap`           |
| `repair`        | `repair`, `fix`                    | `reparatie`, `repareren`        |
| `schedule`      | `schedule`, `event`, `appointment` | `agenda`, `afspraak`            |

Any word not in the alias list is treated as the start of `<text>`
and the type defaults to `shopping`.  (E.g. `add bread` parses as
`addItem({ type: 'shopping', text: 'bread' })`.)

## Output shape from the parser

```js
regexParse(text)
  // → { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }
  // → null  (fall through to LLM slow path)
```

When `null`, the agent routes to `classifyAndExtract` (Phase 3) or,
if the LLM is unavailable, replies with a help hint.

## Edge cases (lock these in tests)

- Empty message → `null`.
- Just the verb, no args → `{ skillId: 'help', args: {} }` for
  unknown shapes (so the user learns the syntax).
- Multiple items in one command (`add bread, milk, eggs`) → split on
  `,` / ` and ` / ` en `; emit ONE skill call per item (the agent
  handles the multi-call; the parser returns an array).
- Quoted text (`add shopping "tomato passata"`) → preserve the
  quotes' contents as a single item.
- Trailing punctuation (`add bread!`, `done bread.`) → strip.
