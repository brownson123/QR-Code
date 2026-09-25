insert into event_staff (event_id, user_id, role)
select e.id, u.id, 'organizer' from events e, auth.users u
where e.slug = 'demo' and u.email = 'you@example.com';