// Navegacao fora das telas (toque numa notificacao push): a mesma referencia
// do NavigationContainer do App.tsx
import { createNavigationContainerRef } from '@react-navigation/native';

export const navegacaoRef = createNavigationContainerRef<Record<string, object | undefined>>();
