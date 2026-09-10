// =====================================================================
// Audit log pentru actiuni admin (cerinta din spec).
// Scrierea esueaza „silentios": un log picat nu trebuie sa blocheze
// actiunea propriu-zisa.
// =====================================================================

/**
 * @param {object} env
 * @param {object} admin - userul care face actiunea
 * @param {string} action - ex: create_series, ban_user, promote_admin
 * @param {string} targetType - series | episode | user | ''
 * @param {number|null} targetId
 * @param {string} details - text scurt, fara date sensibile
 */
export async function logAdminAction(env, admin, action, targetType = '', targetId = null, details = '') {
  try {
    await env.DB.prepare(
      `INSERT INTO admin_log (admin_id, admin_name, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        admin?.id ?? null,
        String(admin?.username || 'necunoscut').slice(0, 20),
        String(action).slice(0, 50),
        String(targetType).slice(0, 20),
        targetId,
        String(details).slice(0, 500)
      )
      .run();
  } catch (e) {
    console.error('admin_log esuat:', e?.message || e);
  }
}

/** Ultimele N intrari din audit log. */
export async function getAdminLog(env, limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const res = await env.DB.prepare(
    `SELECT id, admin_name, action, target_type, target_id, details, created_at
     FROM admin_log ORDER BY id DESC LIMIT ?`
  )
    .bind(safeLimit)
    .all();
  return res.results || [];
}
