import { isSupabaseConfigured, SUPABASE_URL } from '../supabase';
import { sessionManager } from './session-manager';
import type { Habit } from './types';

export async function saveHabits(habits: Habit[]): Promise<void> {
  console.log('[saveHabits] Starting save for', habits.length, 'habits');
  
  if (!isSupabaseConfigured()) {
    console.log('[saveHabits] Supabase not configured, skipping');
    return;
  }
  
  // Get session once at the start (cached, efficient)
  const userId = await sessionManager.getUserId();
  const accessToken = await sessionManager.getAccessToken();
  console.log('[saveHabits] Got userId:', userId?.substring(0, 8) + '...');
  
  const response = await fetch(`${SUPABASE_URL}/functions/v1/encrypt-and-save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      table: 'habits',
      data: habits.map((habit) => ({
        id: habit.id,
        name: habit.name,
        createdAt: habit.createdAt,
      })),
      owner_id: userId,
      replace: true,
    }),
  });

  console.log(`[saveHabits] Response status: ${response.status}`);

  if (!response.ok) {
    let errorMessage = 'Failed to save habits';
    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
      console.error('[saveHabits] Edge function error:', error);
      
      // If it's an auth error, invalidate cache and retry once
      if (response.status === 401) {
        console.log('[saveHabits] Auth error, invalidating cache and retrying...');
        sessionManager.invalidateCache();
        const retryToken = await sessionManager.getAccessToken();
        const retryUserId = await sessionManager.getUserId();
        
        const retryResponse = await fetch(`${SUPABASE_URL}/functions/v1/encrypt-and-save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${retryToken}`,
          },
          body: JSON.stringify({
            table: 'habits',
            data: habits.map((habit) => ({
              id: habit.id,
              name: habit.name,
              createdAt: habit.createdAt,
            })),
            owner_id: retryUserId,
            replace: true,
          }),
        });
        
        if (!retryResponse.ok) {
          const retryError = await retryResponse.json();
          throw new Error(retryError.error || errorMessage);
        }
        console.log('[saveHabits] Retry succeeded');
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message !== errorMessage) {
        throw e;
      }
      const text = await response.text();
      errorMessage = `Failed to save habits (${response.status}): ${text || response.statusText}`;
      console.error('[saveHabits] Non-JSON error response:', text);
    }
    throw new Error(errorMessage);
  }

  console.log('[saveHabits] ✓ All', habits.length, 'habits saved successfully');
}

export async function getHabits(): Promise<Habit[]> {
  console.log('[getHabits] Fetching habits...');
  
  if (!isSupabaseConfigured()) {
    console.log('[getHabits] Supabase not configured');
    return [];
  }
  
  try {
    const userId = await sessionManager.getUserId();
    const accessToken = await sessionManager.getAccessToken();
    console.log('[getHabits] Got userId:', userId?.substring(0, 8) + '...');
    
    const url = `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=habits&owner_id=${userId}`;
    console.log('[getHabits] Calling:', url.substring(0, 60) + '...');
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    console.log('[getHabits] Response status:', response.status);

    if (!response.ok) {
      if (response.status === 401) {
        console.log('[getHabits] Auth error, retrying...');
        sessionManager.invalidateCache();
        const retryToken = await sessionManager.getAccessToken();
        const retryUserId = await sessionManager.getUserId();
        
        const retryResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=habits&owner_id=${retryUserId}`,
          { headers: { 'Authorization': `Bearer ${retryToken}` } }
        );
        if (!retryResponse.ok) {
          console.log('[getHabits] Retry failed with status:', retryResponse.status);
          return [];
        }
        const { data } = await retryResponse.json();
        console.log('[getHabits] Retry succeeded, got', data?.length || 0, 'habits');
        return (data || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          createdAt: item.createdAt,
        }));
      }
      const errorText = await response.text();
      console.error('[getHabits] Error response:', errorText);
      return [];
    }
    
    const responseData = await response.json();
    console.log('[getHabits] Raw response:', JSON.stringify(responseData).substring(0, 500));
    
    // Log debug info if present
    if (responseData._debug) {
      console.log('[getHabits] Debug info:', JSON.stringify(responseData._debug));
      if (responseData._debug.decrypt_errors?.length > 0) {
        console.error('[getHabits] DECRYPT ERRORS:', responseData._debug.decrypt_errors);
      }
    }
    
    const habits = (responseData.data || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      createdAt: item.createdAt,
    }));
    
    console.log('[getHabits] ✓ Loaded', habits.length, 'habits:', habits.map((h: Habit) => h.name).join(', '));
    return habits;
  } catch (error) {
    console.error('[getHabits] Exception:', error);
    return [];
  }
}

export async function addHabit(habit: Habit): Promise<void> {
  await saveHabits([...(await getHabits()), habit]);
}

export async function updateHabit(habitId: string, updates: Partial<Pick<Habit, 'name'>>): Promise<void> {
  const habits = await getHabits();
  await saveHabits(habits.map(h => (h.id === habitId ? { ...h, ...updates } : h)));
}

export async function deleteHabit(habitId: string): Promise<void> {
  await saveHabits((await getHabits()).filter(h => h.id !== habitId));
}

export async function deleteAllHabits(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await saveHabits([]);
  } catch {}
}
