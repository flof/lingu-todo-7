# Shared Family Lists

A shared list app for one household of four adults. It holds endless shopping
lists and one-off packing lists, and is used mainly on phones, including with no
network connection in shops.

## Language

**Member**:
One of the four adults in the household, identified by an account.
_Avoid_: User, person, account

**List**:
A named collection of items, such as "Groceries" or "Holiday packing". A list is
never finished; it exists until its creator archives or deletes it.
_Avoid_: Todo list, checklist, board

**Creator**:
The member who created a list, and the only member who may rename, archive, or
delete it.
_Avoid_: Owner, admin

**Item**:
One line of text in a list, for example "2 butter" or "passports".
_Avoid_: Task, entry, todo

**Amount**:
A number at the start of an item's text saying how many are needed, as in the
"2" of "2 butter". An item without a leading number has an implicit amount of one.
_Avoid_: Quantity, count

**Checked item**:
An item the household has dealt with. It stays in its list, visibly struck
through, until it is cleared.
_Avoid_: Done, completed, ticked

**Cleared**:
The state of a checked item that has been removed from its list.
_Avoid_: Deleted, archived

**Archived list**:
A list its creator has set aside, for example last summer's packing list. It is
out of the way and read-only, but still readable.
_Avoid_: Closed, finished

**Pinned list**:
A list a member keeps at the top of their own list overview.
_Avoid_: Favourite, starred list

**Invite**:
A single-use link a member shares so another person can create a member account.
_Avoid_: Signup code, registration token
