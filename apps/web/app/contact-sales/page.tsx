'use client';

import { useEffect } from 'react';
import {
  Building2,
  User2,
  Mail,
  Phone,
  Users,
  MessageSquare,
  Loader2,
  CheckCircle2,
  ArrowLeft
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { API_URL, useLanguage, Textarea } from '@saas/ui';
import { LanguageSwitcher } from '@/components/language-switcher';

export default function ContactSalesPage() {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    employees: '',
    message: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    document.title = 'Contact Sales | SaaS Multitenant';
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/contact-sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to submit request');
      }

      setSuccess(true);
      setFormData({
        companyName: '',
        contactName: '',
        email: '',
        phone: '',
        employees: '',
        message: ''
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-950 dark:via-indigo-950 dark:to-purple-950 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Animated gradient orbs */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-400/20 dark:bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-400/20 dark:bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="w-full max-w-md relative z-10">
          <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-8 text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {t('contactSales.successTitle')}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t('contactSales.successMessage')}
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('contactSales.backToLogin')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    // html/body don't scroll (globals.css locks them for the dashboard shell), so this page scrolls itself
    <div className="h-full overflow-y-auto">
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-950 dark:via-indigo-950 dark:to-purple-950 relative overflow-hidden">
      {/* Animated gradient orbs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-br from-blue-400/30 to-cyan-400/30 dark:from-blue-600/20 dark:to-cyan-600/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-purple-400/30 to-pink-400/30 dark:from-purple-600/20 dark:to-pink-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-gradient-to-r from-indigo-400/20 to-violet-400/20 dark:from-indigo-600/10 dark:to-violet-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="container mx-auto px-4 py-8 relative z-10">
        <div className="absolute top-4 right-4 z-20">
          <LanguageSwitcher />
        </div>

        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('contactSales.backToLogin')}
            </Link>
            <h1 className="text-4xl font-bold text-foreground mb-4">
              {t('contactSales.title')}
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {t('contactSales.subtitle')}
            </p>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg rounded-lg p-6 text-center shadow-lg border border-gray-200/50 dark:border-gray-700/50 hover:shadow-xl hover:scale-105 transition-all duration-300">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{t('contactSales.featureIsolatedTenants')}</h3>
              <p className="text-sm text-muted-foreground">{t('contactSales.featureIsolatedTenantsDesc')}</p>
            </div>
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg rounded-lg p-6 text-center shadow-lg border border-gray-200/50 dark:border-gray-700/50 hover:shadow-xl hover:scale-105 transition-all duration-300">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{t('contactSales.featureRbacSecurity')}</h3>
              <p className="text-sm text-muted-foreground">{t('contactSales.featureRbacSecurityDesc')}</p>
            </div>
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg rounded-lg p-6 text-center shadow-lg border border-gray-200/50 dark:border-gray-700/50 hover:shadow-xl hover:scale-105 transition-all duration-300">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{t('contactSales.featurePluginSystem')}</h3>
              <p className="text-sm text-muted-foreground">{t('contactSales.featurePluginSystemDesc')}</p>
            </div>
          </div>

          {/* Contact Form */}
          <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-8 md:p-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">
              {t('contactSales.formTitle')}
            </h2>

            {error && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Company Name */}
                <div className="space-y-2">
                  <label htmlFor="companyName" className="text-sm font-medium text-foreground">
                    {t('contactSales.companyName')} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <input
                      id="companyName"
                      name="companyName"
                      type="text"
                      required
                      className="block w-full pl-10 pr-3 py-2.5 border border-input rounded-lg leading-5 bg-transparent placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                      placeholder={t('contactSales.companyNamePlaceholder')}
                      value={formData.companyName}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                {/* Contact Name */}
                <div className="space-y-2">
                  <label htmlFor="contactName" className="text-sm font-medium text-foreground">
                    {t('contactSales.contactName')} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <input
                      id="contactName"
                      name="contactName"
                      type="text"
                      required
                      className="block w-full pl-10 pr-3 py-2.5 border border-input rounded-lg leading-5 bg-transparent placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                      placeholder={t('contactSales.contactNamePlaceholder')}
                      value={formData.contactName}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-foreground">
                    {t('contactSales.emailAddress')} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      className="block w-full pl-10 pr-3 py-2.5 border border-input rounded-lg leading-5 bg-transparent placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                      placeholder={t('contactSales.emailPlaceholder')}
                      value={formData.email}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <label htmlFor="phone" className="text-sm font-medium text-foreground">
                    {t('contactSales.phoneNumber')} <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Phone className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      required
                      className="block w-full pl-10 pr-3 py-2.5 border border-input rounded-lg leading-5 bg-transparent placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                      placeholder={t('contactSales.phonePlaceholder')}
                      value={formData.phone}
                      onChange={handleChange}
                    />
                  </div>
                </div>
              </div>

              {/* Company Size */}
              <div className="space-y-2">
                <label htmlFor="employees" className="text-sm font-medium text-foreground">
                  {t('contactSales.companySize')} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Users className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <select
                    id="employees"
                    name="employees"
                    required
                    className="block w-full pl-10 pr-3 py-2.5 border border-input rounded-lg leading-5 bg-transparent placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors appearance-none cursor-pointer"
                    value={formData.employees}
                    onChange={handleChange}
                  >
                    <option value="">{t('contactSales.companySizeSelect')}</option>
                    <option value="1-10">{t('contactSales.companySize1_10')}</option>
                    <option value="11-50">{t('contactSales.companySize11_50')}</option>
                    <option value="51-200">{t('contactSales.companySize51_200')}</option>
                    <option value="201-500">{t('contactSales.companySize201_500')}</option>
                    <option value="501-1000">{t('contactSales.companySize501_1000')}</option>
                    <option value="1000+">{t('contactSales.companySize1000Plus')}</option>
                  </select>
                </div>
              </div>

              {/* Message */}
              <div className="space-y-2">
                <label htmlFor="message" className="text-sm font-medium text-foreground">
                  {t('contactSales.additionalInfo')}
                </label>
                <div className="relative">
                  <div className="absolute top-3 left-3 pointer-events-none">
                    <MessageSquare className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <Textarea
                    id="message"
                    name="message"
                    rows={4}
                    className="pl-10 resize-none"
                    placeholder={t('contactSales.messagePlaceholder')}
                    value={formData.message}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t('contactSales.submitting')}
                  </>
                ) : (
                  t('contactSales.submitButton')
                )}
              </button>

              <p className="text-xs text-center text-muted-foreground">
                {t('contactSales.termsNotice')}
              </p>
            </form>
          </div>

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground">
              {t('contactSales.alreadyHaveAccount')}{' '}
              <Link href="/login" className="text-primary hover:text-primary/80 font-medium">
                {t('contactSales.signIn')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
