internal sealed class Configuration : DbMigrationsConfiguration<OutdoorContext>
{
    public Configuration() { AutomaticMigrationsEnabled = false; }
}
