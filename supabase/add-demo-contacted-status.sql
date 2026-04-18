-- Add 'contacted' to the status check constraint
alter table public.demo_requests
  drop constraint if exists demo_requests_status_check;

alter table public.demo_requests
  add constraint demo_requests_status_check
  check (status in ('new', 'contacted', 'booked', 'completed', 'cancelled'));
