# Search queries

Graph search and node-group queries use the same Graph Plus query compiler in both 2D and 3D. This is a deliberately bounded grammar, not the complete native Obsidian search language.

## Examples

| Query | Meaning |
|---|---|
| `path:Vampire/ OR path:Demon/` | Notes in either path family |
| `tag:game/vampire OR tag:#game/demon` | Either tag family, including subtags |
| `path:Vampire/ tag:kind/leader` | Both the path and tag conditions |
| `(path:Vampire/ OR path:Demon/) -tag:kind/npc` | Either path family, excluding that tag family |
| `path:"Folder With Spaces/" file:"Autumn People"` | A path prefix and a filename substring containing spaces |
| `[role:"spirit OR-world"] tag:character` | A property substring and a tag condition |
| `-(path:Vampire/ OR path:Demon/)` | Outside both path families |

## Atoms

Syntax prefixes are lowercase. Values match case-insensitively.

| Atom | Match |
|---|---|
| `path:value` | File path starts with the value |
| `file:value` | Basename contains the value |
| `tag:value` or `tag:#value` | Exact tag or a subtag beginning with `value/` |
| `[property:value]` | Any stored frontmatter value contains the value; property keys use letters, digits, or underscores |
| `value` | Basename or file path contains the value |

Projected relationship junctions use their authored relation note's `sourcePath` for path and bare-path matching, rather than their generated junction IDs. Search does not change relationship membership or authored metadata.

## Composition and precedence

```text
query       := conjunction ("OR" conjunction)*
conjunction := unary unary*
unary       := "-" unary | "(" query ")" | atom
```

Whitespace between atoms supplies AND in compound queries. AND binds more tightly than uppercase `OR`; unary minus binds most tightly. Parentheses override the grouping. Spaces are optional beside parentheses and minus, so `-(...)` is supported. Atoms must be separated by whitespace unless a parenthesis supplies the boundary.

`OR` is an operator only as an unquoted standalone word outside a property value. Lowercase `or` is literal text. Explicit `AND`, `NOT`, `||`, and `&&` operators are unsupported and rejected; use whitespace, minus, and `OR` respectively. Other prefixes, such as `status:active`, remain bare literal text and do not introduce new filters. Regexes and other native Obsidian operators are not implemented.

## Phrases and compatibility

Legacy single expressions retain spaces without quotes when no compound syntax appears. For example, `Autumn People`, `file:Autumn People`, and `path:Folder With Spaces/` each remain one expression, and `-file:Autumn People` negates that complete expression.

Compound syntax begins when the query contains parentheses or an uppercase standalone `OR`, a quoted value, a recognized path/file/tag/property atom after another term, a bracketed property atom with another term, or a minus after an earlier term. Once composition begins, unquoted words are separate AND terms. For example, `file:Autumn People tag:character` means `file:Autumn` AND `People` AND `tag:character`; use `file:"Autumn People" tag:character` to retain the filename phrase.

Quote values with either single or double quotes to preserve spaces, parentheses, leading hyphens, or reserved words literally. Examples include `file:"OR -Shadow (Old)"`, `tag:"-hidden"`, and `"AND"`. An internal hyphen or apostrophe in an unquoted word stays literal, as in `OR-world` or `People's`. A field prefix may have whitespace before its value, as in `file: "Autumn People"`. After that whitespace, an unquoted boolean operator or another recognized filter cannot serve as the value: `path: OR path:Demon/` is incomplete and rejected. Quote such text when it is intentional.

Inside quoted values, a backslash escapes the matching quote or another backslash; other backslashes remain literal. For example, `file:'O\'Brien'` matches `O'Brien`. Bracketed property values may contain spaces and `OR` without quotes because the brackets delimit them; quote a property value containing a closing bracket.

## Invalid input and limits

Empty values, incomplete operators, unmatched parentheses/brackets/quotes, malformed property keys, and unsupported boolean operators match no nodes. Invalid expressions remain invalid under negation: `-path:` never becomes a match-all query. An empty query passed to the matcher also matches no nodes; the existing empty search field still disables search filtering.

Queries are limited to 4,096 trimmed characters, 256 tokens, and 32 levels of nested grouping or negation. Compilation is reused across node filtering and node-group matching through a cache limited to 128 distinct queries. The compiler reads query text only and never mutates nodes, settings, or semantic records.
