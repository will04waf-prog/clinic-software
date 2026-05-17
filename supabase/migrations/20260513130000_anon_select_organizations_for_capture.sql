create policy "anon_read_for_capture"
  on public.organizations
  for select
  to anon
  using (true);
