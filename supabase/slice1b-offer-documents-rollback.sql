-- 540 rollback: nothing is deleted (her rule 8). The bucket and every file stay; the open log stays. Only the
-- offer-sign function is removed (by the Desktop rollback step), so nothing can write or read them until it returns.
select 'nothing to undo in the database: the bucket, its files and the open log are kept' as note;
