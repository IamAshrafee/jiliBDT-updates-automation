# Sheet Format Support

The reader requests bounded grid data through `spreadsheets.get` and the renderer primarily uses `formattedValue` plus `effectiveFormat`.

| Feature                              | Phase 1 support                                                        | Warning behavior                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Formatted/effective values           | Supported                                                              | Cell errors produce a warning                                                      |
| Arbitrary RGB background             | Supported generically                                                  | None                                                                               |
| Theme background/text colors         | Supported when resolved by the spreadsheet theme                       | None                                                                               |
| Font family/size/color               | Supported                                                              | Browser fallback applies if a non-installed font is unavailable                    |
| Bold/italic/underline/strike         | Supported                                                              | None                                                                               |
| Borders                              | Supported for Google border styles and colors                          | CSS approximation for thickness/dashes                                             |
| Merged ranges                        | Supported when fully inside the selected range                         | Boundary-crossing merge is blocking                                                |
| Row height/column width              | Supported from pixel metadata                                          | Missing metadata uses compact reference defaults                                   |
| Horizontal/vertical alignment        | Supported                                                              | None                                                                               |
| Wrapping/clipping                    | Supported to a practical CSS equivalent                                | Overflow semantics can differ from Sheets                                          |
| Number formatting                    | Display preserved through `formattedValue`; metadata retained          | Pattern is not independently re-evaluated in HTML                                  |
| Notes                                | Supported as tooltip plus red corner indicator                         | None                                                                               |
| Conditional formatting               | Effective rendered cell format is used                                 | Informational warning records overlapping rules                                    |
| Hidden rows/columns                  | Preserved as hidden                                                    | Warning emitted                                                                    |
| Text rotation                        | Angle/vertical rendering is approximate                                | Vertical text warning                                                              |
| Mixed rich-text runs                 | Partially supported; effective cell format is used                     | Warning emitted                                                                    |
| Hyperlinks                           | Metadata retained; Phase 1 screenshot shows formatted text             | None                                                                               |
| `IMAGE()` formulas                   | Unsupported                                                            | Blocking warning                                                                   |
| Charts/slicers anchored in the range | Unsupported                                                            | Blocking warning                                                                   |
| Drawings and over-grid images        | Google Sheets API coverage is insufficient for guaranteed reproduction | Known Phase 1 limitation; compare with real Sheet and use Phase 3 browser fallback |

The renderer never needs a rule such as “if this is a known management color.” A source background is converted to deterministic CSS and copied directly. Semantic colors from the reference mock are fallback dimensions/style guidance only; source effective formatting wins.
