-- SLICE 2a rollback. Nothing is dropped and no row is deleted (her rule: no record or signed document is ever deleted on
-- rollback). The two tables stay, empty or not, unreachable by anon and authenticated; without the 2b/2c functions
-- nothing writes or reads them. If a later slice must remove them, that is its own approved step.
select 'slice 2a rollback: nothing to undo; the tables stay' as note;
