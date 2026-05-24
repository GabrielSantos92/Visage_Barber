import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import AIVisagismoSection from "@/components/AIVisagismoSection";
import ServicesSection from "@/components/ServicesSection";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1440px] mx-auto">
        <HeroSection />
        <AIVisagismoSection />
        <ServicesSection />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
