# Amount is a leading number in the item's text

Household lists need quantities ("2 butter", "3 rolls"), but only ever as a rough
count, never as something the app calculates with. We decided an item's text may
begin with a number that acts as its amount, and the **+**/**−** buttons
increment or decrement that leading number. An item with no number counts as one,
so the first tap of **+** turns "butter" into "2 butter". There is no separate
quantity column and no unit system. This matches how these lists are written on
paper, and it lets "2 kg flour" and "6-pack" exist without the app ever needing to
understand units.

## Consequences

- Amounts cannot be summed, sorted numerically, or compared — the app treats the
  whole text as opaque.
- The clients own the parse rule (leading integer, if any), so server and clients
  must agree on it exactly; it belongs next to the item text, not in a validator
  that can drift.
- Removing an amount means editing the text, or pressing **−** until the leading
  number disappears.
