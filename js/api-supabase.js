// Data-laag op Supabase. Elk toestel logt anoniem in; RLS in de database
// zorgt dat alleen goedgekeurde gezinsleden de gezinsdata zien.

function check({ data, error }) {
  if (error) throw new Error(error.message || 'Onbekende fout');
  return data;
}

export function createSupabaseApi(url, key) {
  const sb = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bl-auth' },
  });
  let userId = null;
  let channel = null;

  const api = {
    mode: 'supabase',

    async init() {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        userId = data.session.user.id;
      } else {
        const res = check(await sb.auth.signInAnonymously());
        userId = res.user.id;
      }
      return userId;
    },

    get userId() { return userId; },

    /** Lidmaatschap van dit toestel: {member, family} of null */
    async membership() {
      const rows = check(await sb.from('members').select('*, families(*)').eq('user_id', userId));
      if (!rows.length) return null;
      const { families, ...member } = rows[0];
      return { member, family: families };
    },

    async createFamily(name) { return check(await sb.rpc('create_family', { p_name: name })); },
    async joinFamily(code, name) { return check(await sb.rpc('join_family', { p_code: code, p_name: name })); },
    async approveMember(uid) { check(await sb.rpc('approve_member', { p_user: uid })); },
    async removeMember(uid) { check(await sb.from('members').delete().eq('user_id', uid)); },

    async loadAll() {
      const [members, categories, stores, lists, items, positions, entries] = await Promise.all([
        sb.from('members').select('*').order('created_at'),
        sb.from('categories').select('*').order('position'),
        sb.from('stores').select('*').order('position'),
        sb.from('lists').select('*').order('created_at'),
        sb.from('items').select('*'),
        sb.from('item_positions').select('store_id,item_id,pos'),
        sb.from('list_entries').select('*').order('added_at'),
      ]).then((all) => all.map(check));
      return { members, categories, stores, lists, items, positions, entries };
    },

    async insert(table, row) { return check(await sb.from(table).insert(row).select().single()); },
    async update(table, id, patch) { check(await sb.from(table).update(patch).eq('id', id)); },
    async remove(table, id) { check(await sb.from(table).delete().eq('id', id)); },

    async moveCategoryItems(fromId, toId) {
      check(await sb.from('items').update({ category_id: toId }).eq('category_id', fromId));
    },

    async resetStorePositions(storeId) {
      check(await sb.from('item_positions').delete().eq('store_id', storeId));
    },

    async finishShopping(listId, storeId, positions) {
      return check(await sb.rpc('finish_shopping', { p_list: listId, p_store: storeId, p_positions: positions }));
    },

    /** Roept onChange aan bij elke wijziging in de database (door wie dan ook). */
    subscribe(onChange) {
      if (channel) sb.removeChannel(channel);
      channel = sb.channel('gezin');
      for (const table of ['members', 'categories', 'stores', 'lists', 'items', 'item_positions', 'list_entries']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
      }
      channel.subscribe();
    },
  };
  return api;
}
