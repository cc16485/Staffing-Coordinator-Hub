-- 1204 rollback: removes the client_flag_normals key (and any marks in it) and its hub map row.
begin;
delete from public.app_data_key_hub_map where data_key = 'client_flag_normals';
delete from public.app_data where key = 'client_flag_normals';
commit;
