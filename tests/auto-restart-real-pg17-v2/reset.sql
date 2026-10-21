begin;
delete from auto_restart_decisions where account_id='00000000-0000-0000-0000-000000009002';
update incident_resume_authorizations set consumed_by_request_id=null, consumed_at=null,status='armed',expired_at=null,consume_error=null,expires_at=now()+interval '1 hour' where account_id='00000000-0000-0000-0000-000000009002';
delete from account_run_requests where account_id='00000000-0000-0000-0000-000000009002' and id<>'00000000-0000-0000-0000-000000009010';
update account_session_resume_plans set resume_state='awaiting_human_resume_authorization', restart_allowed=true, restart_block_reason='', attempts_in_window=0, last_updated_at=now() where id='00000000-0000-0000-0000-000000009012';
delete from auto_restart_device_locks where account_id='00000000-0000-0000-0000-000000009002';
delete from auto_restart_tick_locks where worker_id='run-dispatcher:local-cert';
commit;
