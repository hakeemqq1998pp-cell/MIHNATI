import { createClient } from '@supabase/supabase-js';

// Public publishable key is safe for browser use; database access is protected by RLS.
// Netlify environment variables can override these defaults if needed.
const url=import.meta.env.VITE_SUPABASE_URL || 'https://swjpiukalygwnufogfdl.supabase.co';
const key=import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_ZT5MIp3Mo9WY8NwHUnIkeg_zGKgin54';
export const supabase=createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
