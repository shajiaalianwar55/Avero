insert into public.users (id, name) values ('usr_001', 'Demo Homeowner') on conflict (id) do nothing;
insert into public.homes (id, user_id, label, city, service_area)
values ('home_001', 'usr_001', 'F-10 Home', 'Islamabad', 'F-10') on conflict (id) do nothing;

insert into public.providers (id, name, categories, service_area, rating, review_count, verification_status) values
  ('pro_007', 'Ahmed Plumbing Services', array['plumbing'], 'Islamabad', 4.8, 127, 'verified'),
  ('pro_008', 'Capital Home Repair', array['plumbing','electrical'], 'Islamabad', 4.6, 89, 'verified'),
  ('pro_009', 'F-10 Plumbing Works', array['plumbing'], 'Islamabad', 4.5, 54, 'seeded_demo')
on conflict (id) do nothing;

insert into public.service_requests (id, user_id, home_id, diagnosis_session_id, payload, status)
values ('sr_001', 'usr_001', 'home_001', 'diag_001', '{"request_id":"sr_001","user_id":"usr_001","home_id":"home_001","diagnosis_session_id":"diag_001","category":"plumbing","issue_summary":"Kitchen sink leaks only while water is running","likely_issue":"Loose or leaking drain connection near P-trap","diagnostic_confidence":0.82,"urgency":"medium","classification":"technician","safety_flags":[],"facts":["Leak stops when tap is off","Water appears below sink cabinet","User could not safely loosen fitting"],"location":{"city":"Islamabad","service_area":"F-10"},"preferred_windows":["today_evening"],"attachments":[],"status":"open"}'::jsonb, 'open')
on conflict (id) do nothing;

insert into public.offers (id, service_request_id, provider_id, payload, raw_response)
values ('off_101', 'sr_001', 'pro_007', '{"offer_id":"off_101","service_request_id":"sr_001","provider_id":"pro_007","visit_fee":1500,"currency":"PKR","estimated_total_min":1500,"estimated_total_max":3500,"parts_included":false,"arrival_window":"19:00-20:00","warranty_days":7,"raw_response":"1500 visit, can come 7ish, parts separate, 7 day service warranty","extraction_confidence":0.94}'::jsonb, '1500 visit, can come 7ish, parts separate, 7 day service warranty')
on conflict (id) do nothing;
