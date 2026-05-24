import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import AuthNavigator from './AuthNavigator';
import ClienteNavigator from './ClienteNavigator';
import BarbeiroNavigator from './BarbeiroNavigator';
import AdminNavigator from './AdminNavigator';
import RedefinirSenhaScreen from '../screens/auth/RedefinirSenhaScreen';

export default function RootNavigator() {
  const { session, loading, userRole, recoveryMode } = useAuth();
  const { C } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (recoveryMode) return <RedefinirSenhaScreen />;
  if (!session) return <AuthNavigator />;
  if (userRole === 'admin') return <AdminNavigator />;
  if (userRole === 'barbeiro') return <BarbeiroNavigator />;
  return <ClienteNavigator />;
}
