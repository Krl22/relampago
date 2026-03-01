import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { AlertCircle, Zap } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
      } else {
        navigate("/");
      }
    } catch (err) {
      setError("Ocurrió un error inesperado al iniciar sesión.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError("Error al iniciar sesión con Google");
      console.error(err);
    }
  };

  return (
    <div className="flex overflow-hidden relative justify-center items-center p-4 w-full h-screen bg-primary">
      {/* Decorative background elements */}
      <div className="overflow-hidden absolute top-0 left-0 w-full h-full pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-accent/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[10%] -left-[10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-3xl"></div>
      </div>

      <Card className="z-10 w-full max-w-md border-0 shadow-2xl">
        <CardHeader className="pt-8 pb-8 space-y-3 text-center">
          <div className="p-3 mx-auto mb-2 rounded-full bg-primary/10 w-fit">
            <Zap className="w-8 h-8 text-primary fill-primary" />
          </div>
          <CardTitle className="text-3xl font-bold text-primary">
            Relámpago Courier
          </CardTitle>
          <CardDescription className="text-base">
            Ingresa a tu cuenta para gestionar envíos
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex gap-2 items-center p-3 text-sm font-medium rounded-md bg-destructive/15 text-destructive animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Correo Electrónico</Label>
              <Input
                id="email"
                type="email"
                placeholder="nombre@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="password">Contraseña</Label>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11"
              />
            </div>
          </CardContent>
          <CardFooter className="pb-8">
            <Button
              className="w-full h-11 text-base font-semibold shadow-lg transition-all hover:shadow-xl"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <div className="flex gap-2 items-center">
                  <div className="w-4 h-4 rounded-full border-2 border-white animate-spin border-t-transparent" />
                  Iniciando...
                </div>
              ) : (
                "Ingresar"
              )}
            </Button>
          </CardFooter>
        </form>
        <div className="px-6 pb-6">
          <div className="relative mb-4">
            <div className="flex absolute inset-0 items-center">
              <span className="w-full border-t" />
            </div>
            <div className="flex relative justify-center text-xs uppercase">
              <span className="px-2 bg-card text-muted-foreground">
                O continuar con
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            type="button"
            className="w-full h-11 font-medium text-gray-700 bg-white border-gray-200 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-900"
            onClick={handleGoogleLogin}
          >
            <svg className="mr-2 w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continuar con Google
          </Button>
        </div>
      </Card>
    </div>
  );
}
