import type {DatabaseSync} from 'node:sqlite';

export const financeTables = [
  'finance_versions','finance_products','finance_markets','finance_lines','finance_periods',
  'finance_sources','finance_inputs','finance_events','finance_project_state','finance_changes','finance_receipts'
];
export const financeEditCapabilities = {
  commercial:'financeCommercialEdit', bom:'financeBomEdit', operations:'financeOperationsEdit',
  factory:'financeFactoryEdit', engineering:'financeEngineeringEdit', prototypes:'financePrototypesEdit',
  validation:'financeValidationEdit', investment:'financeInvestmentEdit', returns:'financeReturnsEdit', budget:'financeBudgetEdit'
} as const;
export const financeCapabilities = [
  'financeRead','financePreview','financeVersionEdit','financeApprove',...Object.values(financeEditCapabilities)
] as const;

export function createFinanceSchema(db:DatabaseSync) {
  db.exec(
    "CREATE TABLE finance_versions ("+
    "id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,"+
    "parent_id TEXT, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','frozen')),"+
    "revision INTEGER NOT NULL CHECK(revision>=0), currency TEXT NOT NULL, currency_scale INTEGER NOT NULL CHECK(currency_scale BETWEEN 0 AND 4),"+
    "basis TEXT NOT NULL CHECK(basis IN ('website','cqa_full','cqa_incremental')),"+
    "as_of TEXT NOT NULL, dictionary_version TEXT NOT NULL, calculation_version TEXT NOT NULL,"+
    "policy_json TEXT NOT NULL, created_uid TEXT NOT NULL REFERENCES identities(uid),"+
    "updated_uid TEXT NOT NULL REFERENCES identities(uid), approved_uid TEXT REFERENCES identities(uid),"+
    "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT,"+
    "UNIQUE(project_id,id), FOREIGN KEY(project_id,parent_id) REFERENCES finance_versions(project_id,id),"+
    "CHECK((status='draft' AND approved_uid IS NULL AND approved_at IS NULL) OR (status='frozen' AND approved_uid IS NOT NULL AND approved_at IS NOT NULL)));"+
    "CREATE INDEX finance_versions_project ON finance_versions(project_id,created_at,id);"
  );
  for(const table of ['finance_products','finance_markets','finance_lines','finance_periods']) {
    db.exec("CREATE TABLE "+table+" ("+
      "project_id TEXT NOT NULL, version_id TEXT NOT NULL, stable_key TEXT NOT NULL,"+
      "label TEXT NOT NULL, metadata_json TEXT NOT NULL,"+
      "PRIMARY KEY(project_id,version_id,stable_key),"+
      "FOREIGN KEY(project_id,version_id) REFERENCES finance_versions(project_id,id));");
  }
  db.exec(
    "CREATE TABLE finance_sources ("+
    "project_id TEXT NOT NULL, version_id TEXT NOT NULL, stable_key TEXT NOT NULL,"+
    "system TEXT NOT NULL, external_key TEXT NOT NULL, fingerprint TEXT, sheet TEXT, cell TEXT,"+
    "owner TEXT NOT NULL, observation TEXT NOT NULL, mapping_status TEXT NOT NULL,"+
    "original_currency TEXT, original_unit TEXT NOT NULL, original_period TEXT NOT NULL,"+
    "effective_from TEXT NOT NULL, effective_to TEXT, metadata_json TEXT NOT NULL,"+
    "PRIMARY KEY(project_id,version_id,stable_key),"+
    "FOREIGN KEY(project_id,version_id) REFERENCES finance_versions(project_id,id));"
  );
  const relationships=
    "FOREIGN KEY(project_id,version_id) REFERENCES finance_versions(project_id,id),"+
    "FOREIGN KEY(project_id,version_id,product_key) REFERENCES finance_products(project_id,version_id,stable_key),"+
    "FOREIGN KEY(project_id,version_id,market_key) REFERENCES finance_markets(project_id,version_id,stable_key),"+
    "FOREIGN KEY(project_id,version_id,line_key) REFERENCES finance_lines(project_id,version_id,stable_key),"+
    "FOREIGN KEY(project_id,version_id,period_key) REFERENCES finance_periods(project_id,version_id,stable_key),"+
    "FOREIGN KEY(project_id,version_id,source_key) REFERENCES finance_sources(project_id,version_id,stable_key)";
  const scope="project_id TEXT NOT NULL, version_id TEXT NOT NULL, stable_key TEXT NOT NULL,"+
    "module TEXT NOT NULL, product_key TEXT, market_key TEXT, line_key TEXT, period_key TEXT NOT NULL, source_key TEXT NOT NULL,";
  const fixed="coefficient TEXT NOT NULL CHECK(typeof(coefficient)='text' AND length(coefficient)>0 AND "+
    "((coefficient NOT GLOB '*[^0-9]*') OR (substr(coefficient,1,1)='-' AND length(coefficient)>1 AND substr(coefficient,2) NOT GLOB '*[^0-9]*'))),"+
    "scale INTEGER NOT NULL CHECK(scale BETWEEN 0 AND 12),";
  db.exec(
    "CREATE TABLE finance_inputs ("+scope+"metric_key TEXT NOT NULL, value_kind TEXT NOT NULL CHECK(value_kind IN ('money','unit_price','rate','quantity')),"+fixed+
    "unit TEXT NOT NULL, currency TEXT, effective_from TEXT NOT NULL, effective_to TEXT, conversion_json TEXT NOT NULL,"+
    "PRIMARY KEY(project_id,version_id,stable_key),"+relationships+");"+
    "CREATE TABLE finance_events ("+scope+"kind TEXT NOT NULL CHECK(kind IN ('budget','incurred','payment','recovery','etc')),"+
    fixed+"currency TEXT NOT NULL, event_date TEXT, related_key TEXT, evidence_key TEXT NOT NULL,"+
    "PRIMARY KEY(project_id,version_id,stable_key),"+relationships+","+
    "FOREIGN KEY(project_id,version_id,related_key) REFERENCES finance_events(project_id,version_id,stable_key) DEFERRABLE INITIALLY DEFERRED);"+
    "CREATE TABLE finance_project_state ("+
    "project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,"+
    "approved_baseline_id TEXT, current_version_id TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),"+
    "FOREIGN KEY(project_id,approved_baseline_id) REFERENCES finance_versions(project_id,id),"+
    "FOREIGN KEY(project_id,current_version_id) REFERENCES finance_versions(project_id,id));"+
    "CREATE TABLE finance_changes ("+
    "id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_id TEXT NOT NULL, operation TEXT NOT NULL,"+
    "revision_before INTEGER, revision_after INTEGER NOT NULL, actor_uid TEXT NOT NULL REFERENCES identities(uid),"+
    "reason TEXT NOT NULL, occurred_at TEXT NOT NULL, before_sha256 TEXT, after_sha256 TEXT NOT NULL, payload_json TEXT NOT NULL,"+
    "FOREIGN KEY(project_id,version_id) REFERENCES finance_versions(project_id,id));"+
    "CREATE TABLE finance_receipts ("+
    "project_id TEXT NOT NULL REFERENCES projects(id), actor_uid TEXT NOT NULL REFERENCES identities(uid), request_key TEXT NOT NULL,"+
    "operation TEXT NOT NULL, request_sha256 TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,"+
    "PRIMARY KEY(project_id,actor_uid,request_key));"+
    "CREATE INDEX finance_changes_version ON finance_changes(project_id,version_id,revision_after);"+
    "CREATE TRIGGER finance_frozen_version_update BEFORE UPDATE ON finance_versions WHEN OLD.status='frozen' BEGIN SELECT RAISE(ABORT,'Frozen finance version'); END;"+
    "CREATE TRIGGER finance_frozen_version_delete BEFORE DELETE ON finance_versions WHEN OLD.status='frozen' BEGIN SELECT RAISE(ABORT,'Frozen finance version'); END;"
  );
  for(const table of ['finance_products','finance_markets','finance_lines','finance_periods','finance_sources','finance_inputs','finance_events']) {
    for(const action of ['INSERT','UPDATE','DELETE']) {
      const ref=action==='INSERT'?'NEW':'OLD';
      db.exec("CREATE TRIGGER "+table+"_"+action.toLowerCase()+"_frozen BEFORE "+action+" ON "+table+
        " WHEN (SELECT status FROM finance_versions WHERE id="+ref+".version_id AND project_id="+ref+".project_id)='frozen'"+
        " BEGIN SELECT RAISE(ABORT,'Frozen finance content'); END;");
    }
    db.exec("CREATE TRIGGER "+table+"_scope_immutable BEFORE UPDATE OF project_id,version_id ON "+table+
      " BEGIN SELECT RAISE(ABORT,'Finance scope is immutable'); END;");
  }
  db.exec("CREATE TRIGGER finance_version_identity BEFORE UPDATE OF id,project_id,parent_id ON finance_versions BEGIN SELECT RAISE(ABORT,'Finance identity is immutable'); END;");
  for(const table of ['finance_changes','finance_receipts']) {
    for(const action of ['UPDATE','DELETE']) db.exec("CREATE TRIGGER "+table+"_"+action.toLowerCase()+"_immutable BEFORE "+action+" ON "+table+
      " BEGIN SELECT RAISE(ABORT,'Finance evidence is append only'); END;");
  }
  const reader=['financeRead'];
  const controller=[...financeCapabilities];
  const groups:[string,string,string[]][]=[
    ['finance-reader','Finance Reader',reader],['finance-controller','Finance Controller',controller]
  ];
  for(const [module,capability] of Object.entries(financeEditCapabilities)) {
    groups.push(['finance-'+module,'Finance '+module,['financeRead','financePreview',capability]]);
  }
  for(const [id,name,caps] of groups) db.prepare('INSERT INTO permission_groups VALUES(?,?,?)').run(id,name,JSON.stringify(caps));
}
