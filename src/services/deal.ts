import { supabase } from '../lib/supabase.js';

export async function createDealFromEvent(params: {
  dealId: number;
  borrowerAddress: string;
}): Promise<void> {
  const { error } = await supabase
    .from('deals')
    .upsert({
      deal_id: params.dealId,
      borrower_address: params.borrowerAddress.toLowerCase(),
    }, { onConflict: 'deal_id' });

  if (error) throw new Error(`Failed to create deal: ${error.message}`);
}

export async function updateDealMetadata(
  dealId: number,
  borrowerAddress: string,
  updates: {
    title?: string;
    description?: string;
    category?: string;
    risk_grade?: string;
    collateral_summary?: string;
    metadata?: Record<string, any>;
  }
): Promise<any> {
  const { data: deal } = await supabase
    .from('deals')
    .select('deal_id, borrower_address')
    .eq('deal_id', dealId)
    .single();

  if (!deal) throw new Error('Deal not found');
  if (deal.borrower_address !== borrowerAddress.toLowerCase()) {
    throw new Error('Not authorized — only the borrower can update deal metadata');
  }

  const { data, error } = await supabase
    .from('deals')
    .update(updates)
    .eq('deal_id', dealId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update deal: ${error.message}`);
  return data;
}

export async function getDeal(dealId: number): Promise<any> {
  const { data, error } = await supabase
    .from('deals')
    .select(`
      *,
      deal_documents(id, type, filename, mime_type, file_size_bytes, created_at)
    `)
    .eq('deal_id', dealId)
    .single();

  if (error || !data) return null;
  return data;
}

export async function listDeals(params?: {
  category?: string;
  riskGrade?: string;
  borrowerAddress?: string;
  limit?: number;
  offset?: number;
}): Promise<{ deals: any[]; total: number }> {
  let query = supabase
    .from('deals')
    .select('deal_id, borrower_address, title, category, risk_grade, collateral_summary, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (params?.category) query = query.eq('category', params.category);
  if (params?.riskGrade) query = query.eq('risk_grade', params.riskGrade);
  if (params?.borrowerAddress) query = query.eq('borrower_address', params.borrowerAddress.toLowerCase());
  if (params?.limit) query = query.limit(params.limit);
  if (params?.offset) query = query.range(params.offset, params.offset + (params.limit || 20) - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to list deals: ${error.message}`);

  return { deals: data || [], total: count || 0 };
}

export async function addDealDocument(params: {
  dealId: number;
  borrowerAddress: string;
  type: string;
  fileUrl: string;
  filename: string;
  mimeType: string;
  fileSizeBytes?: number;
}): Promise<{ id: string }> {
  const { data: deal } = await supabase
    .from('deals')
    .select('deal_id, borrower_address')
    .eq('deal_id', params.dealId)
    .single();

  if (!deal) throw new Error('Deal not found');
  if (deal.borrower_address !== params.borrowerAddress.toLowerCase()) {
    throw new Error('Not authorized');
  }

  const { data, error } = await supabase
    .from('deal_documents')
    .insert({
      deal_id: params.dealId,
      type: params.type,
      file_url: params.fileUrl,
      filename: params.filename,
      mime_type: params.mimeType,
      file_size_bytes: params.fileSizeBytes || null,
      uploaded_by: params.borrowerAddress.toLowerCase(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to add document: ${error.message}`);
  return { id: data.id };
}

export async function deleteDealDocument(
  documentId: string,
  dealId: number,
  borrowerAddress: string
): Promise<void> {
  const { data: deal } = await supabase
    .from('deals')
    .select('borrower_address')
    .eq('deal_id', dealId)
    .single();

  if (!deal || deal.borrower_address !== borrowerAddress.toLowerCase()) {
    throw new Error('Not authorized');
  }

  const { error } = await supabase
    .from('deal_documents')
    .delete()
    .eq('id', documentId)
    .eq('deal_id', dealId);

  if (error) throw new Error(`Failed to delete document: ${error.message}`);
}

export async function getDealDocuments(dealId: number): Promise<any[]> {
  const { data, error } = await supabase
    .from('deal_documents')
    .select('id, type, file_url, filename, mime_type, file_size_bytes, uploaded_by, created_at')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list documents: ${error.message}`);
  return data || [];
}
