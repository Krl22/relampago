import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { AlertCircle, Zap } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError(error.message)
      } else {
        navigate('/')
      }
    } catch (err) {
      setError('Ocurrió un error inesperado al iniciar sesión.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-primary p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-accent/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[10%] -left-[10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-3xl"></div>
      </div>

      <Card className="w-full max-w-md shadow-2xl border-0 z-10">
        <CardHeader className="space-y-3 text-center pb-8 pt-8">
          <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-2">
            <Zap className="h-8 w-8 text-primary fill-primary" />
          </div>
          <CardTitle className="text-3xl font-bold text-primary">Relámpago Courier</CardTitle>
          <CardDescription className="text-base">
            Ingresa a tu cuenta para gestionar envíos
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="h-4 w-4" />
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
              <div className="flex items-center justify-between">
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
            <Button className="w-full h-11 text-base font-semibold shadow-lg hover:shadow-xl transition-all" type="submit" disabled={loading}>
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Iniciando...
                </div>
              ) : 'Ingresar'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
