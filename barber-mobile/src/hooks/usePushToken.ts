import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function usePushToken(tipo: 'barbeiro' | 'cliente') {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    registrar();
  }, [user?.id]);

  async function registrar() {
    if (!Device.isDevice) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const token = (await Notifications.getExpoPushTokenAsync()).data;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    if (tipo === 'barbeiro') {
      await supabase.from('barbeiros').update({ push_token: token } as any).eq('user_id', user!.id);
    } else {
      await supabase.from('profiles').update({ push_token: token } as any).eq('id', user!.id);
    }
  }
}
