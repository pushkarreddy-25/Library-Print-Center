import { supabase, storageBucket } from './supabase';

export async function getCurrentAccount() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, phone, role, print_code, status')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function getJobs({ accountId, staff = false }) {
  let query = supabase
    .from('print_jobs')
    .select('id, user_id, file_name, file_type, file_size, page_count, copies, color_mode, paper_size, sides, orientation, page_range, status, failure_reason, created_at, completed_at, expires_at, profiles!print_jobs_user_id_fkey(name, print_code)')
    .order('created_at', { ascending: false });
  if (!staff) query = query.eq('user_id', accountId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export function subscribeToJobs({ accountId, staff = false, onChange }) {
  const filter = staff ? undefined : `user_id=eq.${accountId}`;
  const channel = supabase
    .channel(`print-jobs-${accountId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'print_jobs', ...(filter ? { filter } : {}) }, onChange)
    .subscribe();
  return channel;
}

export async function createPrintJob({ accountId, file, settings }) {
  const jobId = crypto.randomUUID();
  const storagePath = `${accountId}/${jobId}/${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from(storageBucket)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('print_jobs')
    .insert({
      id: jobId,
      user_id: accountId,
      file_name: file.name,
      storage_path: storagePath,
      file_type: file.type,
      file_size: file.size,
      page_count: settings.pageCount,
      copies: settings.copies,
      color_mode: settings.color === 'Color' ? 'color' : 'bw',
      paper_size: settings.paperSize,
      sides: settings.sides === 'Double-sided' ? 'double' : 'single',
      orientation: settings.orientation || 'auto',
      page_range: settings.pageRange || null,
      status: 'waiting',
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(storageBucket).remove([storagePath]);
    throw error;
  }
  return data;
}

export async function updateJobStatus(jobId, status, failureReason = null) {
  const { data, error } = await supabase
    .from('print_jobs')
    .update({ status, failure_reason: failureReason, completed_at: status === 'completed' ? new Date().toISOString() : null })
    .eq('id', jobId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
