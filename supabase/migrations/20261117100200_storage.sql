-- Private bucket for slides, PDFs and schedules.
-- A player can read an object only while a published file row points at it.

alter table public.feedback alter column created_by set default public.me();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-files', 'team-files', false, 52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy team_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'team-files'
    and (
      public.is_coach()
      or (public.me() is not null
          and exists (select 1 from public.files f
                      where f.storage_path = objects.name and f.published_at is not null))
    )
  );

create policy team_files_coach_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'team-files' and public.is_coach());
create policy team_files_coach_update on storage.objects for update to authenticated
  using (bucket_id = 'team-files' and public.is_coach())
  with check (bucket_id = 'team-files' and public.is_coach());
create policy team_files_coach_delete on storage.objects for delete to authenticated
  using (bucket_id = 'team-files' and public.is_coach());
