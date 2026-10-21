"""Build one atomic, exact-history Phase A transaction. No database access."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
NAMES = ('20260906171034_fleet_admission_authority_v1.sql', '20260907124340_fleet_atomic_request_device_lease_v1.sql', '20260907133415_fleet_human_resume_atomic_alignment_v1.sql', '20260907135729_fleet_safe_expired_lease_reclaim_v1.sql', '20260907140225_fleet_device_lease_release_transfer_fencing_v1.sql', '20260907142233_fleet_device_lock_exact_operation_receipts_v1.sql', '20260907143123_fleet_admission_recovery_token_binding_v1.sql', '20260907171458_fleet_mutation_rpc_caller_authorization_v1.sql', '20260907193846_fleet_policy_mutation_caller_v1.sql', '20260907205851_fleet_prospective_hold_participation_v1.sql', '20260907233046_fleet_operator_facade_v1.sql', '20260908112814_fleet_phase_a_legacy_compatibility_v1.sql')

def build():
    inventory=[]
    parts=["BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s';"]
    for i,name in enumerate(NAMES):
        path=ROOT/'supabase/migrations'/name
        raw=path.read_text()
        sha=hashlib.sha256(raw.encode()).hexdigest()
        version,label=name[:-4].split('_',1)
        inventory.append(dict(path=str(path),version=version,name=label,sha256=sha))
        tag='$phase_a_'+sha[:12]+'$'
        body=re.sub(r'(?mi)^\s*(?:begin|commit);\s*$','',raw)
        assert tag not in raw
        outer='$phase_a_step_'+str(i)+'$'
        assert outer not in raw
        parts.append(f"""DO {outer}
declare prior text[];
begin
  select statements into prior from supabase_migrations.schema_migrations where version='{version}';
  if found then
    if prior is distinct from ARRAY[{tag}{raw}{tag}] then
      raise exception 'phase_a_history_mismatch:{version}';
    end if;
  else
    execute {tag}{body}{tag};
    insert into supabase_migrations.schema_migrations(version,name,statements)
      values('{version}','{label}',ARRAY[{tag}{raw}{tag}]);
  end if;
end {outer};""")
    parts.append('COMMIT; SELECT true AS phase_a_applied;')
    return dict(phase_a=inventory,phase_b_deferred=['supabase/deferred/20260908112856_fleet_phase_b_legacy_retirement_deferred_v1.sql'],phase_b_required_for_v1=False),'\n'.join(parts)+'\n'

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    inventory,sql=build()
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'migration-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
    (args.output/'phase-a-atomic-apply.sql').write_text(sql)
